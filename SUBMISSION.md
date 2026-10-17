# Devpost submission draft (edit with your real details)

**Title:** Hearth: a calm Alexa+ companion for medicines and mood
**Tagline:** Alexa+ helps your parent remember, and tells you only when it matters.

## Inspiration
Millions of families coordinate care from a distance. Missed medicines and quiet changes in mood are easy to miss, and constant alerts make caregivers numb. We wanted a companion that talks like a person and speaks up only when there is a real pattern.

## What it does
- Amina talks to Alexa+: logs doses, asks what is left, says how she feels.
- Hearth stores it through MCP tools and watches for patterns: two missed doses in 24h, three low moods in a row, no first activity after her own usual time (personalised baseline).
- Before sharing anything proactive, Alexa+ asks Amina for consent (MCP elicitation).
- Salma asks "How is mum doing?" and gets two clear sentences plus an interactive dashboard (MCP App). Urgent words trigger a safe response: call local emergency number first, then notify the caregiver.

## How we built it
Node + the official MCP SDK. A spec-compliant Streamable HTTP server (stateful sessions, Origin validation, resumable SSE, server push) with 8 tools and 3 resources, including an MCP App (ui:// dashboard rendered inline), elicitation-based consent for proactive alerts, and a personalised routine baseline. An Agent Skill (SKILL.md) defines when to call each tool and the escalation rules. A web simulator shows both roles and the live MCP traffic. Protocol-level tests cover tool listing, validation and the escalation flow.

## Challenges
Choosing when NOT to alert. We encoded the rules in the skill and in the summary tool, so the agent decides from data, not vibes.

## Accomplishments
A complete, testable loop from voice phrase to tool call to caregiver signal, with safety rules written down and enforced in code.

## What we learned
Agent Skills are the right place for policy; tools should stay small, validated and honest about failure.

## What's next
Household auth, persistent storage, real Ring/IoT signals, clinician-ready weekly report, a sandbox-proxy MCP Apps host, testing on real Alexa+ and other MCP hosts.

## Product feedback (they asked for it: fill with YOUR real experience)
- What worked: [..]
- What got in your way: [..]
- Feature request: [..]

## Built with
Node.js, Model Context Protocol (Streamable HTTP, MCP Apps, elicitation), Agent Skills, Express, Zod

## Try it
Repo: [PUBLIC GITHUB URL]  ·  Live demo: [URL, optional]  ·  Run locally: `npm install && npm start`

## Demo video
File `docs/demo.mp4` (43 s, captions only). See docs/DEMO_SCRIPT.md for a voice-over version.

## Demo video checklist (2-3 min)
1. Problem in 15s. 2. Amina: good morning, took metformin, "I feel tired". 3. Press +3 h, show missed dose and low-mood flag. 4. Salma asks "How is mum doing?". 5. "I fell" shows the emergency-first response. 6. Show the live MCP traffic panel.
