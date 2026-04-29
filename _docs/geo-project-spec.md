# Blue River Gutters — GEO (Generative Engine Optimization) Project Spec

> **Status:** Drafted April 29, 2026
> **Owner:** Untitled Publishers (Dave / Micaiah)
> **Client:** Blue River Gutters (Adam Bussey)
> **Goal:** Become the AI-cited gutter authority for North Alabama

---

## Why this exists

Search is changing. Every query is becoming a conversation. Every conversation cites sources. Companies that show up in those AI citations win the next decade of search traffic.

Blue River Gutters is already getting **301 AI bot requests per day** as of April 28, 2026 — including 97 from ChatGPT-User, which fires when real users ask ChatGPT about gutter services. That's not theoretical. That's happening right now.

This project ensures Blue River wins the AI search era for North Alabama.

---

## Core objectives

1. **Citations** — Be the cited source when ChatGPT, Claude, Perplexity, and Gemini answer "gutter" questions in the North Alabama region
2. **Referrals** — Convert AI-referred visitors into leads at higher rate than general traffic (they arrive pre-qualified)
3. **Measurement** — Track AI traffic, AI citations, and AI-attributed leads in a dedicated dashboard
4. **Authority** — Build content depth that establishes Blue River as the definitive North Alabama gutter resource

---

## Phased Roadmap

### Phase 1: Foundation — Tracking & Measurement Infrastructure
**Timeline:** ~1 week
**Why first:** You can't optimize what you don't measure.

**Deliverables:**
- Dedicated AI Insights page in `/admin/`
- Capture referrer at form submit (which AI led to lead)
- Track all major AI engines: ChatGPT, Claude, Perplexity, Gemini, Copilot, You.com
- AI-attributed leads in Conversions tab
- AI bot crawl monitoring (which AIs are reading us, which pages)

**Success criteria:**
- Can answer: "How many leads came from AI referrals last week?"
- Can answer: "Which pages do AI bots crawl most?"
- Can answer: "Which AI engine drives the most traffic?"

---

### Phase 2: Schema Saturation — Make Every Page Machine-Readable
**Timeline:** ~2 weeks
**Why this matters:** AI bots can't guess what's on your site. Structured data (JSON-LD) tells them explicitly.

**Deliverables:**
- Service schema on every service page (price ranges, areas served, included items)
- FAQPage schema on every page that answers questions
- HowTo schema on instructional articles
- Review schema with aggregate rating
- Place schema for each city page (geo coordinates, service radius)
- BreadcrumbList schema site-wide for context

**Success criteria:**
- Every page validates clean in Google's Rich Results Test
- Every page has at least 2 schema types

---

### Phase 3: Content Rewrite — Optimize for AI Consumption
**Timeline:** ~3 weeks
**Why this matters:** AI engines extract specific facts. Lead with answers, support with details. Rewrite hero content to be quotable.

**Deliverables:**
- Add direct-answer paragraph to every page (TL;DR for AI)
- Restructure service pages: Q→A format, scannable subheadings
- Add specific pricing ranges where possible (AI loves citing prices)
- Citations: link to authoritative sources (manufacturers, building codes)
- Local specificity: name actual neighborhoods, schools, landmarks per city page

**Success criteria:**
- Every service page has a quotable single-paragraph summary
- Every city page references at least 3 specific local features

---

### Phase 4: Authority Hub — Build the Gutter Knowledge Base
**Timeline:** ~4 weeks
**Why this matters:** AI cites whoever has the most useful, specific, structured information. Become that source for North Alabama gutters.

**Deliverables:**
- "Ultimate Guide to Gutters in North Alabama" pillar page
- Glossary page (50 gutter terms with definitions)
- Cost calculator with structured pricing
- Climate-specific guides (red clay drainage, pine needle problems, storm season)
- Decision trees: "Which gutter is right for my home"
- `llms.txt` file at root (proposed standard for AI crawler instructions)

**Success criteria:**
- Pillar page ranks for "gutters North Alabama guide"
- Glossary cited as authoritative source by AI engines

---

### Phase 5: Off-Site Signals — Build Authority AI Engines Trust
**Timeline:** Ongoing (concurrent with above)
**Why this matters:** AI engines weight third-party validation heavily. They check Wikipedia, Reddit, business directories, news mentions.

**Deliverables:**
- Get listed in every relevant business directory
- Local press mentions (Huntsville Times, AL.com, local news)
- Reddit presence in r/HomeImprovement, r/Huntsville
- YouTube content (AI engines increasingly cite video sources)
- Wikipedia-adjacent: contribute to gutter-related Wikipedia entries
- Get on "best gutter contractors" listicles from authority sites

**Success criteria:**
- 25+ quality external citations
- Brand mentions in AI summaries when querying competitors

**Investment required:** ~$500-2000 for paid directories, possible PR outreach

---

### Phase 6: Monitoring & Iteration
**Timeline:** Ongoing
**Why this matters:** Don't fly blind. Test what AI engines actually say about Blue River and competitors.

**Deliverables:**
- Monthly AI citation audit: ask top 10 AI engines key questions, log who they cite
- Competitor AI tracking: see when Mr Gutter / Gutter Gliders get cited
- Build citation tracking dashboard tab
- Quarterly content refresh based on emerging AI query patterns
- Evaluate paid AI partnerships (Perplexity Pro, ChatGPT Search ads when available)

**Success criteria:**
- Blue River appears in 5+ different AI engines for "gutters Huntsville"
- Citation rate increases month-over-month

---

## Why Blue River Will Win This

1. **Local moat.** No national gutter brand cares about Madison, Hartselle, Hampton Cove. AI will pick whoever shows up first with depth.
2. **Technical foundation.** 11ty + Cloudflare + Cloudinary stack is already faster and more crawlable than 95% of competitor sites.
3. **Existing content depth.** 30+ blog posts, city-specific landing pages, real local detail (red clay, pine needles, flood plain). AI is already eating it.
4. **Active AI traffic.** 301 daily bot requests means the engines are already listening. We just need to give them better food.
5. **Untitled Publishers playbook.** Once GEO works for Blue River, the same model rolls to every UP client.

---

## Decisions Needed

- [ ] **Scope** — Run all 6 phases sequentially? Or focus on 1–3 first?
- [ ] **Pace** — Sprint (one phase per week) or steady (one per month)?
- [ ] **Investment** — Adam's budget for content, listings, third-party services?
- [ ] **UP Rollout** — Build this once with Blue River as the prototype, then productize for all UP clients?

---

## Recommended Starting Point

**Phase 1 this week.** We already have the infrastructure (admin dashboard, GA4, Cloudflare). Add the AI tracking page now. Real data beats guessing.

**Phase 2 next.** Schema is technical and doesn't require Adam's input — we can ship it without involving him.

**Then evaluate.** By month-end you'll have measurement infrastructure AND machine-readable content. We look at what the data is telling us before committing to phases 3+.

---

## Open Questions

1. Should we build a separate microsite (e.g., `gutters.bluerivergutters.com`) for the authority hub, or keep it on the main domain?
2. Adam's involvement level — does he want to be in the loop on every phase, or just see results?
3. Should other UP clients be in scope as part of this project, or is this Blue River-only for now?
4. Cloudflare Pay Per Crawl — revisit after Phase 1 data comes in to see if it's worth turning on for training-only bots.

---

*This spec is a living document. Update as we learn from execution.*
