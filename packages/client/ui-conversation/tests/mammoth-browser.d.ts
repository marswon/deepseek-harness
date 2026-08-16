// Ambient declaration for mammoth's browser UMD entry, which ships no type
// declarations. Specs cast the default export to `MammothFace` from
// draft-office.ts, so `unknown` keeps the cast site authoritative.
declare module 'mammoth/mammoth.browser' {
  const mammoth: unknown
  export default mammoth
}
