# Leanness

Use the smallest solution that actually satisfies the accepted plan. This is an implementation
constraint and a review axis, not permission to skip validation, security, accessibility, or
error handling that prevents data loss.

## Ladder

Stop at the first rung that works:

1. Does this need to exist at all? If speculative, skip it and say why.
2. Does the standard library do it?
3. Does the native platform feature cover it?
4. Does an already-installed dependency solve it?
5. Can it be one line?
6. Otherwise write the minimum code that works.

Avoid unrequested abstractions: no interface with one implementation, no factory for one product,
no config for a value nobody changes, no layer with one caller.

## Review tags

Use these tags for over-engineering findings:

- `delete:` dead code, unused flexibility, or speculative feature.
- `stdlib:` hand-rolled behavior available in the standard library.
- `native:` code or dependency doing what the platform already does.
- `yagni:` abstraction, option, or layer without a real second use.
- `shrink:` same behavior in fewer lines.
