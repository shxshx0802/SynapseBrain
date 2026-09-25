declare module 'mammoth/mammoth.browser' {
  interface ExtractResult {
    value: string
    messages: unknown[]
  }
  function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<ExtractResult>
  export { extractRawText }
}
