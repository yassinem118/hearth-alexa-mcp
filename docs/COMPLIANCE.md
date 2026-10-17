# Alexa+ track: requirements and evidence

Track text: "Build a working MCP (Model Context Protocol) integration on the open standards for Agent Skills and Streamable HTTP transports. You can simulate an Alexa+ experience using your preferred agentic tools via a web app."

| Requirement | Evidence in this repo | How to verify |
|---|---|---|
| Working MCP integration | `server.js`: 8 tools, 3 resources, built on the official `@modelcontextprotocol/sdk` | `npm test` (23 checks) |
| **Streamable HTTP** transport | Single `/mcp` endpoint (POST/GET/DELETE), JSON or SSE replies, `MCP-Session-Id`, `MCP-Protocol-Version`, 202 for notifications, Origin validation (403), localhost bind, resumable SSE via `Last-Event-ID`, server push | tests under "Transport security & lifecycle" and "Server push over GET SSE + resumability" |
| **Agent Skills** open standard | `skills/hearth-care/SKILL.md` (frontmatter `name` = folder name, `description`) with tool-use, consent and hard-limit rules | test "SKILL.md has valid Agent Skills frontmatter" |
| Simulated Alexa+ experience via a web app | `public/index.html`: two roles (Echo and caregiver app), real MCP client, live traffic panel | `npm start`, open http://127.0.0.1:3000 |
| Open standards beyond the minimum | MCP Apps (`ui://` view, `_meta.ui`, app-only tool), elicitation, resource subscriptions, structured content | tests "tool linked to ui:// resource", "proactive alert asks consent" |

## Not covered (honest)
- No real Alexa+ device or Alexa+ service was available, so nothing was run on it.
- No third-party MCP host (Claude, ChatGPT, VS Code) was used to test the MCP App. Our simulator is the host.
- The track list does not mention AWS or open-source contributions; this project does not claim those mini-challenges.
- Rules, judging criteria and deadline of the hackathon were not provided to us; check the Devpost page before submitting.

## Submission checklist (you)
- [ ] Put your name in `LICENSE`, push to a PUBLIC GitHub repo
- [ ] Upload `docs/demo.mp4` (43 s) or record your own with voice-over (see `docs/DEMO_SCRIPT.md`)
- [ ] Paste `SUBMISSION.md` into Devpost and fill the Product feedback section with your real experience
- [ ] Add screenshots from `docs/screenshots/`
- [ ] Select the Alexa+ track on Devpost; deploy a live URL if the rules ask for one (see `docs/DEPLOY.md`)
