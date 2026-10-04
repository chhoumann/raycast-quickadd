import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type InteractiveSession,
  type SessionState,
  driveSession,
} from "./interactive";

let server: Server | undefined;

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
});

/** A prompt server that hands out `events` in order, then idles. */
async function promptServer(events: object[]) {
  const requests: string[] = [];
  server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      // drain the body
    }
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    requests.push(`${req.method} ${path}`);
    const send = (body: object) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (path !== "/poll") return send({ ok: true, interrupted: 0 });
    const event = events.shift();
    if (event) send(event);
    else setTimeout(() => send({ kind: "idle" }), 20);
  });
  await new Promise<void>((resolve) =>
    server?.listen(0, "127.0.0.1", resolve),
  );
  const session: InteractiveSession = {
    host: "127.0.0.1",
    port: (server.address() as AddressInfo).port,
    sessionId: "s",
    token: "t",
  };
  return { session, requests };
}

function drive(session: InteractiveSession, initial: SessionState) {
  const states: SessionState[] = [];
  const driver = driveSession(session, {
    initial,
    onChange: (state) => states.push(state),
  });
  return { driver, states };
}

describe("driveSession", () => {
  it("aborts the run when the user cancels while no prompt is open", async () => {
    const { session, requests } = await promptServer([]);
    const { driver, states } = drive(session, { state: "connecting" });
    await vi.waitFor(() => expect(requests).toContain("GET /poll"));

    driver.cancel();

    await vi.waitFor(() => expect(requests).toContain("POST /abort"));
    expect(states).toEqual([{ state: "cancelled" }]);
  });

  it("aborts the run when the view goes away mid-work", async () => {
    const { session, requests } = await promptServer([]);
    const { driver } = drive(session, {
      state: "prompt",
      pending: {
        requestId: "r1",
        prompt: { type: "confirm", header: "Proceed?" },
      },
    });
    driver.answer(true);
    await vi.waitFor(() => expect(requests).toContain("POST /reply"));

    driver.dispose();

    await vi.waitFor(() => expect(requests).toContain("POST /abort"));
  });

  it("sends no abort after the run is done", async () => {
    const { session, requests } = await promptServer([
      { kind: "done", result: { ok: true } },
    ]);
    const { driver, states } = drive(session, { state: "connecting" });
    await vi.waitFor(() =>
      expect(states).toEqual([{ state: "done", result: { ok: true } }]),
    );

    driver.cancel();
    driver.dispose();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).toEqual(["GET /poll"]);
    expect(states).toEqual([{ state: "done", result: { ok: true } }]);
  });
});
