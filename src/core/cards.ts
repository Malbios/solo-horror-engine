/** Card instances are named `<definition id>:<serial>`. */
export function cardDefinitionId(cardInstance: string): string {
  return cardInstance.slice(0, cardInstance.lastIndexOf(":"));
}
