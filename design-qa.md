# Design QA — UN-47 neobrutalist Markdown chat

## Comparison target

- Source visual truth: `C:\Users\djlop\AppData\Local\Temp\codex-clipboard-835faac4-b477-47c8-9a05-6f248650f327.png`.
- Source pixels: 400 × 300.
- Implementation: local Next.js chat, browser-rendered during this QA run.
- Density normalization: not required. The reference is a desktop portfolio while the implementation is a responsive chat; comparison is limited to the approved structural neobrutalist design language.

## Evidence and states

- Desktop, 1440 × 900 CSS viewport: empty state and a completed Markdown response with a heading and list.
- Tablet, 768 × 1024 CSS viewport: completed Markdown response.
- Mobile, 390 × 844 CSS viewport: completed Markdown response.
- Console errors: none.
- Primary interaction tested: submit a general prompt and render its completed Markdown response.

## Required fidelity surfaces

### Fonts and typography

Geist is applied as the body font. The page heading uses a heavy display weight and compact tracking; labels, controls and Markdown hierarchy remain readable at every tested viewport.

### Spacing and layout rhythm

The application uses a centered outlined shell, large header spacing, a separated transcript and an independent composer. Mobile reduces the outer margin and shadow while preserving the composer controls.

### Colors and visual tokens

The warm canvas, white surfaces, black outlines, flat teal, yellow and pink state colors, and solid offset shadows are centralized as `--nb-*` tokens. No gradients or soft card shadows are used.

### Image quality and asset fidelity

No decorative assets are present. This is an intentional scope decision: the requested chat adopts the reference's structural visual language without reproducing its portfolio illustrations or stickers.

### Copy and content

Spanish product copy remains clear. Model responses support semantic Markdown, while user messages and Host confirmation commands stay literal text.

## Findings

- No actionable P0, P1 or P2 findings.
- [P3] The compact mobile hint wraps to two lines for very narrow widths. It remains readable and does not obscure a control.

## Implementation checklist

- [x] Apply warm neobrutalist tokens and hard outlines.
- [x] Render completed assistant replies through a safe CommonMark + GFM renderer.
- [x] Keep user, confirmation and error text literal.
- [x] Block raw HTML, unsafe URLs and remote images.
- [x] Verify desktop, tablet and mobile states.

final result: passed
