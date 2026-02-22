# Marketing Landing Page

## Goal
Build a modern, premium marketing landing page for doctors featuring our portfolio, price list, social links (WhatsApp, Facebook, Instagram), and utilizing our specific brand color palette.

## Project Type
WEB

## Success Criteria
- [x] Page looks premium and prominently uses the specified brand colors.
- [x] Portfolio section displays case images cleanly.
- [x] Price list is clearly visible and easy to read.
- [x] Contact/Social buttons (WhatsApp, Facebook, Instagram) are functional and well placed.
- [x] The background incorporates dental lab case examples in a premium way.
- [x] The page is completely separate from the core program logic/login.

## Tech Stack
- Frontend: React / Next.js
- Styling: Tailwind CSS (Strictly using the provided brand palette)

## File Structure
- `src/components/marketing/` (or similar folder for marketing components)
- `src/components/marketing/HeroSection.tsx`
- `src/components/marketing/PortfolioSection.tsx`
- `src/components/marketing/PricingSection.tsx`
- `src/components/marketing/ContactSection.tsx`
- Main entry point for the landing page (e.g., `src/app/(marketing)/page.tsx` or `src/pages/index.tsx`)

## Task Breakdown
- [x] **Task 1: Add Custom Brand Colors.** Update `tailwind.config.ts`/`.js` to include the specific custom colors (Black, Slate, Aqua, Sky Blue, Blue, Off-white) and remove any unused defaults. → Verify: Custom color config allows usage in components like `bg-brand-blue`.
- [x] **Task 2: Build Base Marketing Layout.** Create a standalone layout that does not embed the lab portal's sidebar or authentication state. → Verify: Viewing the page shows a blank page without the app sidebar.
- [x] **Task 3: Implement Hero Section.** Include the background with dental cases and primary marketing copy. → Verify: Hero background, headline, and call-to-action render correctly across mobile and desktop.
- [x] **Task 4: Implement Portfolio Section.** Create an image grid or slider featuring the lab's work. → Verify: Grid displays sample images appropriately.
- [x] **Task 5: Implement Pricing Section.** Display the price list seamlessly integrated into the premium aesthetic. → Verify: Pricing table or cards display correctly.
- [x] **Task 6: Implement Contact Section & Social Links.** Add buttons for WhatsApp, Facebook, and Instagram. → Verify: Buttons exist, look premium, and link to the correct social accounts.

## Phase X: Verification (Final Checks)
- [x] **Color Contrast:** Verify all brand colors pass accessibility contrast checks.
- [x] **UX & Mobile:** Test responsive layout to ensure buttons and portfolio scale correctly on phones.
- [x] **Performance:** Check image loading in the hero and portfolio to ensure they don't impact Core Web Vitals.
- [x] **Visual Audit:** Confirm no template/generic layouts or purple/violet colors are used.
