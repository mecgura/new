/**
 * Phone contact exports often embed every contact's photo as base64, which makes a few thousand contacts several MB.
 * Photos, logos, sounds and keys are never used, so the browser drops them before upload. Names, numbers and emails stay.
 */
export function stripVcfBinary(text: string): string {
  const normalised = text.replace(/\r\n|\r/g, "\n");
  return normalised.replace(/^(?:[\w-]+\.)?(?:PHOTO|LOGO|SOUND|KEY)[^:\n]*:[^\n]*(?:\n[ \t][^\n]*)*\n?/gim, "");
}
