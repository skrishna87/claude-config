# Security Review

A focused security pass over a diff: flag only genuine, **exploitable** vulnerabilities, prove the
missing mitigation *before* you flag, and prioritise by exploitability × impact. One use in the
loop — a **review axis** the gate runs (`/review-task`, Reviewer C), alongside Claude, codex, and
leanness.

> Adapted from vercel-labs/deepsec (Apache-2.0) — its core investigation prompt, triage rubric, and
> per-tech threat highlights, distilled for diff-scoped review. **Static analysis only:** read the
> source, never run, exploit, or send requests against the code.

## Mindset

Think like an attacker hunting subtle logic flaws, not a linter matching textbook patterns. The
costly bugs are auth bypasses via parameter manipulation, cross-tenant ID confusion, and
trust-boundary violations — things a regex misses. Use the diff's flagged lines as starting points,
then read the flows they join for ANY exploitable issue. Non-security bugs you spot belong to the
correctness axis — hand them over, don't double-report them here.

## Severity (exploitable by an attacker)

- **CRITICAL** — RCE; auth bypass granting full access; SQL injection on sensitive data;
  unrestricted upload → RCE; SSRF to internal services.
- **HIGH** — XSS; SSRF; privilege escalation; hardcoded secrets/credentials in source; insecure
  deserialization; missing authorization on a sensitive operation.
- **MEDIUM** — open redirect; weak crypto; missing rate limiting; info disclosure; IDOR; race
  conditions; logic bugs in an auth/permission check.

## False-positive discipline (check BEFORE flagging)

A finding without a demonstrated missing mitigation is noise. For each candidate, confirm the
mitigation is genuinely absent:

- Is the input parameterised / escaped at the sink? (prepared statement, HTML-escape, allowlist.)
- Is there a framework guard that **wraps this handler directly**? Only handler-level auth counts —
  Express/Koa middleware mounted before the route, Fastify `preHandler`, NestJS `@UseGuards`, Spring
  filter, Rails `before_action`, Django decorator, FastAPI `Depends`. **Edge / proxy / CDN / WAF /
  front-of-stack middleware is NOT sufficient on its own** — too easy to bypass via a route that
  escapes the matcher.
- Is the pattern only ever fed trusted/internal data, never user input?
- For redirects: is there an explicit allowlist or same-origin check before the redirect?

Fully mitigated → do not flag. Report only genuine, exploitable issues.

## Auth-bypass catalog (the subtle ones)

Code that *looks* authed often isn't:

- **Parameter pollution** — duplicate query params (`?teamId=x&teamId=y`) changing behaviour.
- **Encoding tricks** — `%2F` vs `/`, double-encoding, `%00`, Unicode normalisation around a path or
  auth check.
- **Cross-tenant IDs** — user-supplied `teamId`/`userId` used in the DB query instead of the
  authenticated identity. "Logged in" is verified, "owns this resource" is not.
- **Header trust** — `X-Forwarded-For`, `Authorization`, custom `x-*` trusted blindly.
- **OAuth / JWT** — state or `redirect_uri` tampering; missing algorithm pinning; stub/test sessions
  reachable in prod.
- **Inverted logic** — `!(await auth.can(...))`, a negated check, or a comment that contradicts the
  code (a Critical tell).

## Triage → blocking rule

Classify each *confirmed* finding by **exploitability × impact**, then map to a priority:

- **P0 — blocks.** Trivially exploitable (one crafted request/URL) by an external attacker, direct
  impact on user data / auth / code execution, no mitigation in place.
- **P1 — blocks.** Real vulnerability but gated (needs valid auth, a feature flag, a race, internal
  access). Moderate impact.
- **P2 — advisory.** Low-impact, difficult to exploit, or defense-in-depth. Surfaced, not blocking.
- **skip** — false positive / already mitigated / test-only / too vague to act on. Drop it.

Exploitability: *trivial* (single request) · *moderate* (needs setup) · *difficult* (chained/unlikely).
Impact: *critical* (auth bypass, RCE, cross-tenant exfil) · *high* (single-tenant access, privesc,
secret) · *medium* (info disclosure, DoS, weak crypto) · *low* (theoretical).

## Per-tech threat highlights

Apply **only** the entries whose tech actually appears in the diff. These name threats and FP
mitigations a scanner can't see — pointers, not tutorials. If the stack isn't listed, fall back to
the principles above. (deepsec ships ~30 of these; this is the high-signal subset — grow it as your
stacks do.)

**Agent / LLM / MCP** *(highest relevance here)*
- A tool/function definition handed to an LLM is an exec surface — a tool that runs shell, writes
  files, or fetches URLs from model-chosen args is an injection sink. Constrain and validate args.
- Untrusted text reaching a prompt (user input, fetched pages, prior tool output) is prompt
  injection — never let it silently escalate tool use or exfiltrate the system prompt / secrets.
- Agent loops need a hard turn/step cap **and** a cost ceiling — an uncapped loop on user input is
  DoS / runaway spend.
- Don't echo the system prompt, keys, or tokens into model-visible context, logs, or traces.

**Next.js**
- `middleware.ts` runs at the edge and is NOT sufficient auth — bypassable via routes that escape
  the matcher; auth must also live in the handler.
- Server Actions are publicly callable POST endpoints — each needs explicit auth + authorization.
- `JSON.stringify()` inside `dangerouslySetInnerHTML` / inline `<script>` is XSS unless `</` is escaped.
- `searchParams` and dynamic segments (`[id]`, `[...slug]`) are untrusted, including in middleware.
- `unstable_cache` / `revalidateTag` on user-supplied keys can leak across tenants.

**React**
- `dangerouslySetInnerHTML` with any user-influenceable string (DB values and usernames count) is XSS.
- Effects/refs touching `document.location` / `window.opener` → open-redirect or tabnabbing.

**Node / Express**
- Each `app.<verb>` / `router.use` is public — confirm auth middleware wraps it; routes mounted
  before `app.use(auth)` are unprotected (order matters).
- `req.query` / `req.params` / `req.body` are user input → SQL / shell / path / URL sinks.
- `res.sendFile(req.params.x)` or `express.static` on a user-influenced root is path traversal.
- Error handlers sending `err.stack` / `err.message` leak internals; CORS `origin: true` reflecting
  credentials enables CSRF-via-fetch.

**Go (net/http + Gin / Echo / Fiber / Chi)**
- Each route reg (`r.GET/POST`, `r.Group`, `e.GET`, `app.Get`, `mux.HandleFunc`) is public — auth
  middleware (`Use(...)`) must be registered BEFORE the routes in its group; `Mount` / sub-routers
  don't inherit middleware added after the mount.
- `c.Query` / `c.Param` / `c.Bind(&v)` (Gin/Echo/Fiber) and `r.URL.Query()` / `mux.Vars(r)`
  (net/http) are untrusted → SQL / `os/exec` / filepath / URL sinks.
- SQL: `db.Query(fmt.Sprintf(...))` or concatenated queries are injection; the safe form is
  placeholders (`"… WHERE id = $1", id`).
- `exec.Command` (or `sh -c`) built from request data is RCE; `http.Get` / `http.NewRequest` on a
  request-derived URL is SSRF (no allowlist → internal / metadata endpoints).
- `html/template` auto-escapes (`{{.X}}`); `text/template` emitted as HTML, or `template.HTML(userInput)`, is XSS.
- Fiber wraps fasthttp — `c` / body / headers aren't safe to retain past handler return; goroutines
  capturing `c` by reference are a bug.

**Cloudflare Workers / Edge**
- `export default { fetch(req, env, ctx) }` is the only entry — auth lives in `fetch`, no framework gates.
- `env.<BINDING>` exposes KV / R2 / D1 / secrets — check for over-permissioned bindings.
- `caches.default` keys include the full URL — query strings poison the cache unless normalised.

**Python web (FastAPI / Django / Flask)**
- FastAPI: auth is `Depends(...)`; a route with none is public. `response_model=...` filters output —
  without it you may return secret DB columns.
- Django: `@csrf_exempt` on a state-changing POST; `.raw()` / `cursor.execute()` with f-strings
  (SQLi); `mark_safe()` on user input (XSS); `ModelForm` with `__all__` (mass assignment);
  `DEBUG=True` + `ALLOWED_HOSTS=['*']` leaks tracebacks and `SECRET_KEY`.
- Flask: `render_template_string(user_input)` is SSTI → RCE; `@app.route` must be the outermost
  decorator over `@login_required`; a hardcoded `secret_key` is session forgery.

**GraphQL**
- Every Query/Mutation/Subscription field is independently reachable — flag resolvers that skip `context.user`.
- Object-level auth ≠ field-level: returning a User exposes `email` / `role` unless those fields are guarded.
- No depth/complexity limit + aliasing/batching = amplified unauthenticated cost.

## Output

One line per confirmed finding, grouped P0/P1 (blocking) then P2 (advisory):

`<P0|P1|P2> <file>:L<n> — <vuln-slug>: <what's exploitable> — <fix>.`

End with exactly one line: `VERDICT: PASS` (no unresolved P0/P1) or `VERDICT: FAIL`. If nothing is
exploitable, say `No exploitable findings.` and PASS. Do not invent issues to look thorough; do not
rubber-stamp a real bypass.
