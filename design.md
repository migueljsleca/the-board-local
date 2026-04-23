# Design System

## Overview
A dark, editorial interface for a visual board and moodboard workflow.
The product should feel quiet, precise, and image-led rather than playful or highly branded.
Use a monochrome-first palette, restrained contrast shifts, thin borders, and minimal chrome so the imagery remains the focal point.
The overall tone is technical, curated, and slightly cinematic: dense enough for serious curation work, but still spacious around hero content and modal overlays.

## Colors
- **Primary** (#f5f7fa): High-emphasis text, selected borders, the most important action on a dark surface
- **Secondary** (#111317): Default application surfaces, canvas background, dark panels, and shell layers
- **Tertiary** (#14171d): Detached overlays, menus, dropdowns, floating panels, and modal shells
- **Neutral** (#050608): Deep page background, hero backdrop, and the darkest framing layer
- **Outline** (#ffffff1f): Hairline borders, dividers, and control boundaries on dark surfaces
- **Muted Text** (#ffffff8c): Secondary copy, metadata, hints, and inactive utility labels
- **Destructive** (#fb7185): Delete actions, destructive warnings, and attention states

Favor dark neutral layering over colorful surfaces. Most hierarchy should come from opacity, border contrast, blur, and image content rather than saturated fills.

## Typography
- **Headline Font**: Geist Mono
- **Body Font**: Geist Mono
- **Label Font**: Geist Mono

Headlines are uppercase or tightly tracked, with a sharp editorial feel rather than a warm product-marketing tone.
Body text generally sits between 12px and 16px and uses reduced white opacity instead of switching to a lighter neutral gray.
Labels and utility metadata often use 10px to 12px sizing with uppercase styling and extended tracking for section headers, filters, and helper chrome.

Using one family across headline, body, and label roles is intentional. The system should feel cohesive, technical, and restrained, not expressive through font mixing.

## Elevation
This design system is mostly flat.
Depth is created with dark surface stacking, backdrop blur, border contrast, and selective shadow use on floating elements.
Persistent layout regions should not feel raised. Menus, search dialogs, lightboxes, and floating inspectors can use soft, large-radius black shadows to separate from the canvas or image field.

When elevation appears, use it sparingly:
- floating overlays can use deep black shadows with long blur
- cards can use subtle shadow only when they sit above a denser image field
- primary structure should still read as flat and architectural

## Components
- **Buttons**: Monochrome, border-led controls. Primary actions use white text with a subtle white-tinted fill on dark surfaces. Secondary actions are mostly transparent with a 1px border. Destructive actions use rose-tinted text or background treatment. Keep padding compact and avoid loud fills.
- **Inputs**: Dark translucent backgrounds, 1px outline borders, small mono text, and understated placeholder text. Focus states should increase border contrast rather than add colorful glow.
- **Dropdowns and Popovers**: Use dark detached surfaces with light borders, soft blur, and compact spacing. They should feel like utility panels, not playful menus.
- **Boards and Filter Chips**: Small rectangular or minimally rounded chips with tight padding, thin borders, and sharp typography. Selected state should increase contrast clearly without introducing bright accent color.
- **Cards**: Image cards in the masonry view use soft container rounding, thin outlines, and dark gradients or overlays to reveal metadata on hover or focus. Card chrome should disappear behind the image whenever possible.
- **Modal Surfaces**: Search, lightbox, and context menus should use dark frosted panels with careful border contrast. They should feel precise and cinematic, not heavy.
- **Canvas Tools**: The freeform canvas uses a near-black background with pale selection outlines and minimal utility controls. Editing affordances should read as professional tooling, similar to design or asset-management software.
- **Navigation**: Sidebar and toolbar controls are compact, text-first, and quiet by default. Use uppercase micro-labels for structure, not decoration.

## Do's and Don'ts
- Do keep the UI monochrome-first and let uploaded imagery provide most of the visual variety.
- Do use thin borders and opacity shifts to separate layers before reaching for new colors.
- Do keep controls compact and utility-focused.
- Do use uppercase, tracked labels for board structure, metadata, and navigation headers.
- Do reserve the brightest white treatment for the most important action, selected object, or highest-priority text.
- Don't introduce bright brand colors across general UI surfaces.
- Don't make controls feel soft, playful, or consumer-app rounded by default.
- Don't rely on large shadows for primary structure; reserve elevation for detached overlays.
- Don't let helper chrome compete with images.
- Don't mix warm, friendly UI patterns into the main workspace. The tone should stay technical and curated.
