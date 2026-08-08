# 09 — Token-saved estimates placement and format

Type: grilling
Status: closed

## Question

Feature 4 appends token savings info after `aiknow_search` results. Decisions:

1. **Where does the calculation live?** In the tool's response postprocessor (inside the Pi extension), or in the core engine's response formatter?
2. **Format**: One-liner like Graft (`[aiknow] tokens saved ≈ X (Y%) vs reading N files whole`) or more detailed?
3. **Always show or conditional?** Only when savings > some threshold (e.g., >20%)? Or always, to train the agent consistently?
4. **Accuracy**: Token estimate at 4 chars/tok is rough. Should we use a proper tokenizer, or is the approximation fine for a training signal?

## Resolution

1. **Calculation lives in the aiKnow core engine** response formatter — reusable across all consumers (Pi, VS Code, CLI, etc.), not duplicated per integration.
2. **Structured data** returned from engine: raw number fields (`tokensSaved`, `tokensSavedPercent`, `filesAvoided`). Each consumer templates its own display string.
3. **Always included** — engine returns the fields on every response (even savings = 0). Consumers apply their own display threshold.
4. **4 chars/tok approximation** is sufficient — no tokenizer dependency needed. This is a training signal, not billing; precision doesn't change agent behavior.
