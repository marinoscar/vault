// =============================================================================
// Which secret types are never handled over MCP (and so never revealed to an assistant)
// =============================================================================
//
// One definition for the MCP surface (`mcp/mcp-secrets.service.ts`) and the owner's "Reveal to
// assistants" toggle (`SecretsService.updateAssistantReveal`, #244): the toggle refuses these types
// (422 ASSISTANT_REVEAL_UNSUPPORTED_TYPE) and the tools treat them as missing. Kept in its own file so
// `secrets/` and `mcp/` do not import each other for it.
// =============================================================================

/** The system types MCP never handles (ADR-0004 adds the identity documents to the card). */
export const MCP_EXCLUDED_SYSTEM_TYPES: readonly string[] = ['card', 'passport', 'id document'];

/**
 * Types never handled through MCP: no creation, no listing, no reveal, and a get or update answers as
 * for a missing secret. The system types `Card`, `Passport` and `ID Document`, and any type with a
 * cvv-like field.
 */
export function isMcpExcludedType(type: { name: string; isSystem?: boolean; fields: unknown }): boolean {
  if (type.isSystem && MCP_EXCLUDED_SYSTEM_TYPES.includes(type.name.toLowerCase())) return true;
  const fields = Array.isArray(type.fields) ? (type.fields as Array<{ name?: unknown }>) : [];
  return fields.some((f) => typeof f?.name === 'string' && /^(cvv|cvc|security_code(_\d+)?)$/i.test(f.name));
}
