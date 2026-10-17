// In-memory EventStore: makes SSE streams resumable via Last-Event-ID (MCP Streamable HTTP, "Resumability and Redelivery").
export function createEventStore(maxPerStream = 200) {
  const streams = new Map(); // streamId -> [{n, message}]
  let counter = 0;
  return {
    async storeEvent(streamId, message) {
      const n = ++counter;
      const list = streams.get(streamId) ?? [];
      list.push({ n, message });
      if (list.length > maxPerStream) list.shift();
      streams.set(streamId, list);
      return `${streamId}::${n}`;
    },
    async getStreamIdForEventId(eventId) { return eventId.split("::")[0]; },
    async replayEventsAfter(lastEventId, { send }) {
      const [streamId, last] = [lastEventId.split("::")[0], Number(lastEventId.split("::")[1])];
      for (const e of streams.get(streamId) ?? []) if (e.n > last) await send(`${streamId}::${e.n}`, e.message);
      return streamId;
    },
  };
}
