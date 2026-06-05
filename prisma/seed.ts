/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Tier catalog — must match docs/03 §2 exactly.
// amountMinor is in kobo (₦1 = 100 kobo).
const TIERS = [
  {
    slug: 'free',
    displayName: 'Free',
    amountMinor: 0n,
    sortOrder: 0,
    featureTemplate: {
      planning: { maxMembers: 4 },
      invitees: { maxInvitees: 20, customQuestions: 0 },
      event: { maxSegments: 3 },
      sharing: { ads: true, calendarExport: false, emailReminders: false, customSlug: false },
      ai: { perSegmentSuggestions: false, copilot: false },
      places: { enabled: false, quota: 0 },
      budget: { realTimeReconciliation: false },
      branding: { customSharePage: false, whiteLabelSubdomain: false },
      marquee: { livestream: false, ndaMode: false, csvExport: false, webhookApi: false },
    },
  },
  {
    slug: 'gathering',
    displayName: 'Gathering',
    amountMinor: 250_000n, // ₦2,500
    sortOrder: 1,
    featureTemplate: {
      planning: { maxMembers: 12 },
      invitees: { maxInvitees: 80, customQuestions: 0 },
      event: { maxSegments: null },
      sharing: { ads: false, calendarExport: true, emailReminders: true, customSlug: false },
      ai: { perSegmentSuggestions: false, copilot: false },
      places: { enabled: false, quota: 0 },
      budget: { realTimeReconciliation: false },
      branding: { customSharePage: false, whiteLabelSubdomain: false },
      marquee: { livestream: false, ndaMode: false, csvExport: false, webhookApi: false },
    },
  },
  {
    slug: 'occasion',
    displayName: 'Occasion',
    amountMinor: 950_000n, // ₦9,500
    sortOrder: 2,
    featureTemplate: {
      planning: { maxMembers: 30 },
      invitees: { maxInvitees: 250, customQuestions: 3 },
      event: { maxSegments: null },
      sharing: { ads: false, calendarExport: true, emailReminders: true, customSlug: true },
      ai: { perSegmentSuggestions: true, copilot: false },
      places: { enabled: true, quota: 20 },
      budget: { realTimeReconciliation: true },
      branding: { customSharePage: false, whiteLabelSubdomain: false },
      marquee: { livestream: false, ndaMode: false, csvExport: false, webhookApi: false },
    },
  },
  {
    slug: 'production',
    displayName: 'Production',
    amountMinor: 3_900_000n, // ₦39,000
    sortOrder: 3,
    featureTemplate: {
      planning: { maxMembers: 100 },
      invitees: { maxInvitees: 1500, customQuestions: 10 },
      event: { maxSegments: null },
      sharing: { ads: false, calendarExport: true, emailReminders: true, customSlug: true, publicInviteLink: true, analytics: true, highlightReel: true },
      ai: { perSegmentSuggestions: true, copilot: true },
      places: { enabled: true, quota: 100, vendorContactReveal: true },
      budget: { realTimeReconciliation: true },
      branding: { customSharePage: true, whiteLabelSubdomain: false },
      marquee: { livestream: false, ndaMode: false, csvExport: false, webhookApi: false },
      support: { priority: true },
    },
  },
  {
    slug: 'marquee',
    displayName: 'Marquee',
    amountMinor: 14_900_000n, // ₦149,000
    sortOrder: 4,
    featureTemplate: {
      planning: { maxMembers: null }, // unlimited
      invitees: { maxInvitees: null, customQuestions: null },
      event: { maxSegments: null },
      sharing: { ads: false, calendarExport: true, emailReminders: true, customSlug: true, publicInviteLink: true, analytics: true, highlightReel: true },
      ai: { perSegmentSuggestions: true, copilot: true },
      places: { enabled: true, quota: null, vendorContactReveal: true },
      budget: { realTimeReconciliation: true },
      branding: { customSharePage: true, whiteLabelSubdomain: true },
      marquee: { livestream: true, ndaMode: true, csvExport: true, webhookApi: true },
      support: { priority: true },
    },
  },
];

const ADDONS = [
  { slug: 'ai_vibe_pack',       displayName: 'AI vibe pack',                        amountMinor: 150_000n, featurePatch: { ai: { vibePack: true } } },
  { slug: 'holiday_scanner',    displayName: 'Holiday & conflict scanner',           amountMinor:  90_000n, featurePatch: { ai: { holidayScanner: true } } },
  { slug: 'vendor_shortlist',   displayName: 'Smart vendor & venue shortlist (one-shot)', amountMinor: 450_000n, featurePatch: { places: { enabled: true, quotaAdd: 20 } } },
  { slug: 'anonymous_proposals', displayName: 'Anonymous proposals',                 amountMinor: 150_000n, featurePatch: { room: { anonymousProposals: true } } },
  { slug: 'decision_postmortem', displayName: 'Decision postmortem report',          amountMinor: 150_000n, featurePatch: { postEvent: { postmortem: true } } },
  { slug: 'plan_again',          displayName: 'Plan-again rollover',                 amountMinor:  90_000n, featurePatch: { postEvent: { clone: true } } },
  { slug: 'highlight_reel',      displayName: 'Photo highlight reel',                amountMinor: 350_000n, featurePatch: { postEvent: { highlightReel: true } } },
  { slug: 'sponsor_mode',        displayName: 'Sponsor / donation mode',             amountMinor: 500_000n, featurePatch: { monetization: { donations: true } } },
  { slug: 'custom_email_from',   displayName: 'Custom email-from address',           amountMinor: 450_000n, featurePatch: { email: { customFrom: true } } },
  { slug: 'planner_small',       displayName: 'Hire a vetted planner (small)',       amountMinor: 2_500_000n, featurePatch: { marketplace: { planner: true, bracket: 'small' } } },
  { slug: 'planner_medium',      displayName: 'Hire a vetted planner (medium)',      amountMinor: 6_000_000n, featurePatch: { marketplace: { planner: true, bracket: 'medium' } } },
  { slug: 'planner_large',       displayName: 'Hire a vetted planner (large)',       amountMinor: 15_000_000n, featurePatch: { marketplace: { planner: true, bracket: 'large' } } },
];

async function main(): Promise<void> {
  console.log('Seeding tiers…');
  for (const tier of TIERS) {
    await prisma.tier.upsert({
      where: { slug: tier.slug },
      update: { ...tier, currency: 'NGN', active: true },
      create: { ...tier, currency: 'NGN', active: true },
    });
  }

  console.log('Seeding add-ons…');
  for (const addon of ADDONS) {
    await prisma.addon.upsert({
      where: { slug: addon.slug },
      update: { ...addon, currency: 'NGN', active: true },
      create: { ...addon, currency: 'NGN', active: true },
    });
  }

  console.log(`✓ Seeded ${TIERS.length} tiers and ${ADDONS.length} add-ons.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
