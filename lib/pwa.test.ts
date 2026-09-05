import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const cache = { add: vi.fn().mockResolvedValue(undefined) };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(["sigaretta-offline-v0", "sigaretta-offline-v1", "other-app"]),
    delete: vi.fn().mockResolvedValue(true),
    match: vi.fn().mockResolvedValue(new Response("offline")),
  };
  const fetch = vi.fn().mockResolvedValue(new Response("live"));
  const claim = vi.fn().mockResolvedValue(undefined);
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self: { addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; }, location: { origin: "https://game.test" }, clients: { claim } },
    caches, fetch, URL, Response,
  });
  return { handlers, caches, cache, fetch, claim };
}

describe("PWA: rete e isolamento dati", () => {
  it("salva solo la pagina offline e pulisce solo le proprie vecchie cache", async () => {
    const w = worker();
    let pending: Promise<unknown> | undefined;
    const event = { waitUntil: (promise: Promise<unknown>) => { pending = promise; } };
    w.handlers.install(event);
    await pending;
    expect(w.cache.add.mock.calls).toEqual([["/offline.html"]]);
    w.handlers.activate(event);
    await pending;
    expect(w.caches.delete.mock.calls).toEqual([["sigaretta-offline-v0"]]);
    expect(w.claim).toHaveBeenCalledOnce();
  });

  it.each([
    ["/api/room/ABCD/state", "GET", "cors"],
    ["/api/room/ABCD/state", "GET", "navigate"],
    ["/api/room/ABCD/answer", "POST", "cors"],
    ["/r/ABCD?_rsc=test", "GET", "cors"],
    ["https://other.test/", "GET", "navigate"],
  ])("non intercetta %s (%s, %s)", (path, method, mode) => {
    const w = worker();
    const respondWith = vi.fn();
    w.handlers.fetch({ request: { url: new URL(path, "https://game.test").href, method, mode }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it("carica le stanze dalla rete e mostra offline solo se la rete fallisce", async () => {
    const w = worker();
    let pending: Promise<Response> | undefined;
    const event = { request: { url: "https://game.test/r/ABCD", method: "GET", mode: "navigate" }, respondWith: (promise: Promise<Response>) => { pending = promise; } };
    w.handlers.fetch(event);
    expect(await (await pending)!.text()).toBe("live");
    expect(w.caches.match).not.toHaveBeenCalled();
    w.fetch.mockRejectedValueOnce(new TypeError("offline"));
    w.handlers.fetch(event);
    expect(await (await pending)!.text()).toBe("offline");
    expect(w.cache.add).not.toHaveBeenCalled();
  });
});
