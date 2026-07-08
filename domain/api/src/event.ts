export const SUBJECT = "colour.generated";
export const SOURCE = "urn:outcome-app-pattern:behaviour-service";

export interface ColourGeneratedEvent {
  id: string;
  source: typeof SOURCE;
  specversion: "1.0";
  type: typeof SUBJECT;
  time: string;
  data: { colour: string; timestamp: string };
}

/** Structured CloudEvent for the outbox / events queue. Kept as a plain object
 * so we depend on nothing fragile to serialise it. */
export function buildEvent(colour: string, ts: string): ColourGeneratedEvent {
  return {
    id: crypto.randomUUID(),
    source: SOURCE,
    specversion: "1.0",
    type: SUBJECT,
    time: ts,
    data: { colour, timestamp: ts },
  };
}
