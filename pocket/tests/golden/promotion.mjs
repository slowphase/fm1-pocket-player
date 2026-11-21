// Promotion scenarios over the recorded golden inputs (used by identity.test.mjs and pocket/emu/test_catalog.py)
import { read } from "./golden.mjs";

// The Firmware Hub adds KickSide (an Editor-first firmware, Pocket id "kickside") under its own id: a copy of a Hub row
// with KickSide's repository
export function hubWithKickSide(id = "kicksidefm", repo = "kjs4discovery/kicksidesidekick") {
  const hub = structuredClone(read("discover-inputs.json.gz").hub);
  const blop = hub.catalog.firmwares.find((h) => h.id === "blop");
  hub.catalog.firmwares.push({ ...structuredClone(blop), id, name: "KickSide", repo, author: "kjs4discovery", added: "2026-11-25",
                               published: "2026-11-24T10:00:00Z", version: "0.10.7" });
  return hub;
}

// RemoteFM1FW builds GLITCH (Pocket id "glitch-ttreu") as "glitchdrums", its file and manifest id, and catalog.json offers it
export function rfm1WithGlitch() {
  const inp = read("discover-inputs.json.gz");
  const v1 = structuredClone(inp.v1), upstream = structuredClone(inp.upstream);
  const amb = v1.firmwares.find((f) => f.id === "amb");
  v1.firmwares.push({ ...structuredClone(amb), id: "glitchdrums", name: "GLITCH", file: "fw/glitchdrums-1234abcd.rfm1",
                      source: "https://github.com/ttreu/fm1-glitch", authors: ["ttreu"], version: "0.4.0" });
  const it = upstream.items.find((x) => x.file.startsWith("amb-"));
  upstream.items.push({ ...structuredClone(it), file: "glitchdrums-0.4.0.rfm1", name: "GLITCH 0.4.0", source: "https://github.com/ttreu/fm1-glitch", author: "ttreu" });
  return { v1, upstream };
}
