export const PACK_SCHEMA_VERSION = 1;

export type PackMeta = {
  id: string;
  version: string;
  schemaVersion: typeof PACK_SCHEMA_VERSION;
  name: string;
};

export type ZoneDefinition = {
  id: string;
  name: string;
};

export type CardDefinition = {
  id: string;
  name: string;
};

export type DeckDefinition = {
  startZone: string;
  cards: CardDefinition[];
};

export type TrackDefinition = {
  id: string;
  name: string;
  min: number;
  max: number;
  start: number;
};

export type Pack = {
  meta: PackMeta;
  zones: ZoneDefinition[];
  deck: DeckDefinition;
  tracks: TrackDefinition[];
};
