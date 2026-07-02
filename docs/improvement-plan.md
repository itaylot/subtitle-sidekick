# App Improvement Plan — Subtitle Sidekick

Ideas for making the app itself better (features, UX, information architecture) — separate from
[distribution-plan.md](distribution-plan.md), which is about *shipping*. Not a commitment; a ranked
menu to pull from. Keep the app **simple and student-focused** — every item below is weighed against
"does a student actually benefit, or is it bloat?"

**Guiding constraints:** no embedded endpoint/key, no shared server, local-first private default,
keep it lean (no framework, no build step), commits without `Co-Authored-By`.

---

## 1. Information architecture — a dedicated Library screen  ⭐ (top recommendation)

**The problem today:** the whole app is really just *home dashboard* + a *cramped side drawer* for
courses. The drawer (`renderDrawer`) is good for a quick jump to a lecture, but it's a poor place to
*manage* things — narrow, one course open at a time, no sense of progress, fiddly to move lectures.
Course management is exactly where the recent bugs lived, partly because it's squeezed into a 300px rail.

**Proposal:** add a third top-level screen, **Library** (`view-library`), reachable from the top bar
(the ☰ can open it, or a dedicated "📚 Library" button). Two levels:

1. **Courses overview** — a responsive grid of course cards. Each card shows: course name, lecture
   count, watched/total progress bar, last-activity date. A "no course" card collects loose lectures.
   Uses the wider window we just enabled.
2. **Course detail** — click a card → the course's lectures as a real list/table: title, duration,
   watched state, and inline actions (▶ watch · ✎ rename · 📁 move · 🗑 remove). A search box filters
   *within* the course. Optionally: select multiple → bulk move / bulk delete.

**Why it's worth it:** it's the natural "dashboard vs. management" split, it makes the fixed course
bugs feel solid instead of cramped, and it finally uses the responsive layout. The drawer stays as a
lightweight quick-nav; Library is the full view.

**Keep it lazy:** reuse `lecturesByCourse()` and the existing library data — no new backend, no new
data model. Cards + a detail list, nothing more. **Skip:** drag-and-drop between courses, kanban
boards, nested folders — all bloat for a per-student lecture app.

- [ ] `view-library` overview grid (course cards with progress)
- [ ] Course-detail list with per-lecture actions + in-course search
- [ ] Wire top-bar navigation (Home / Library / drawer as quick-nav)
- [ ] (optional) multi-select bulk move/delete

---

## 2. Course & lecture management polish

- [ ] **Course progress everywhere** — "3/8 watched" on cards and the home recent-courses chips.
- [ ] **Move-to-course from the Library detail** (not only the ⋯ menu), with the fixed DOM-built select.
- [ ] **Empty-course cleanup prompt** — offer to remove a course that ends up with 0 lectures (currently
      kept on purpose so new empty courses survive; a gentle "this course is empty, remove it?" is nicer
      than silent pruning).
- [ ] **Sort options** — by date added / title / watched. Small, high-value for a growing library.

## 3. Player & study features (the actual point of the app)

- [ ] **Bookmarks / notes per lecture** — mark a timestamp with a short note; list them beside the
      transcript, click to jump. This is the highest-value *study* feature and fits the mission.
- [ ] **"Applied corrections" surface** — after a transcription, show which dictionary rules fired
      (transparency; already planned in the dictionary design).
- [ ] **Chapter markers** — auto-detect long pauses as rough chapter breaks for easier navigation.
- [ ] **Remember playback speed** per user (currently resets to 1x).

## 4. Transcription flow

- [ ] **Auto-select cloud when configured** — if a RunPod endpoint is saved, default the mode to cloud
      (it's the flagship). Keep local as the explicit fallback. (Deliberately not done yet to avoid
      surprising the default; revisit.)
- [ ] **Per-course default language** — a course that's always English shouldn't need re-picking each time.
- [ ] **Better failure recovery messaging** — distinguish "server asleep/cold start" from "real error."

## 5. Correction dictionary — next steps

- [ ] **Per-course dictionary** (deferred by design) — a course-scoped rule set layered over the global
      one. The data model already leaves room (`dictionary.json` could grow a `by_course` map). Only if
      the global one proves too blunt in practice.
- [ ] **Import/export the dictionary** — share term lists between machines.

## 6. Accessibility & robustness

- [ ] **Focus trapping in modals** — the new confirm modal should trap Tab and restore focus on close.
- [ ] **Keyboard nav for the transcript** — arrow between cues, Enter to jump.
- [ ] **`prefers-color-scheme`** — default to the OS theme on first run (currently defaults to light).
- [ ] **Large-library performance** — if the lecture list grows to hundreds, virtualize the list render.

## 7. Deliberately NOT doing (guardrails against bloat)

- ❌ Accounts / sync / multi-device — breaks the local-first, no-account promise.
- ❌ A shared/hosted transcription service — violates the core constraint.
- ❌ Focus/study "modes", gamification, spaced-repetition scheduling — scope creep; it's a transcription
      + player app, not an LMS. (Focus mode was already dropped for this reason.)
- ❌ A JS framework / build step — the no-build vanilla stack is a feature, not a limitation.

---

## Rough priority

1. **Library screen (#1)** — biggest structural improvement, unlocks the rest of course management.
2. **Bookmarks/notes (#3)** — highest study value.
3. **Course progress + sort (#2)** — cheap, visible.
4. Everything else as appetite allows. Guard every addition against section 7.
