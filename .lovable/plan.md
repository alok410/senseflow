## Goal

Keep the Senseflow SMS template body **byte-for-byte identical** to the DLT-approved text, replacing only the first `{#var#}` with the random 6-digit OTP. The other four `{#var#}` placeholders stay as literal text.

## Current state

`src/lib/otp.functions.ts` → `buildMessage(otp)` already does this:

```
Dear <OTP>, payment for Invoice No. {#var#} related to {#var#} services amounting to Rs.{#var#} was due on {#var#} and is still pending. Kindly pay immediately to avoid service interruption. SENSEFLOW INSTRUMENTS PRIVATE LIMITED.
```

## Change

- Rewrite `buildMessage` to build the string by taking the template constant verbatim and doing a single `replace` on the first `{#var#}` only — no interpolation, no wording edits, no added/removed spaces or punctuation.
- Store the template as a single string constant so it is visibly identical to the DLT copy.
- No other files change. No DB / secrets / UI changes.

## Verification

- Log the outgoing message once in dev to confirm bytes match the template with only the first placeholder swapped.
- Manual test: request OTP for `+918780488532`, confirm received SMS matches the template exactly.
