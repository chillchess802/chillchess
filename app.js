/**
 * Chill Chess — Dynamic Schedule & UI Controller
 *
 * Calculates the next upcoming Sunday session (10:00 AM – 12:00 PM ET),
 * supports skipped/holiday off-week detection with a conditional footnote,
 * and dynamically displays an event note when present on the scheduled Sunday.
 */

const CLUB_CONFIG = {
  calendarId: "chillchess802@gmail.com",
  /**
   * Optional Google Calendar API Key (restricted to chillchess.org).
   * When set (and the calendar's public sharing is set to "See all event details"),
   * `app.js` automatically fetches upcoming events from Google Calendar to detect
   * off-weeks and display any event description as the Next Meetup note.
   */
  googleCalendarApiKey: "",
  publicCalendarUrl:
    "https://calendar.google.com/calendar/embed?src=chillchess802%40gmail.com&ctz=America%2FNew_York",
  timeZone: "America/New_York",
  startHour: 10, // 10:00 AM
  endHour: 12, // 12:00 PM
  venueName: "South Burlington Public Library",
  venueAddress: "180 Market Street, South Burlington, VT 05403",

  /**
   * List of skipped Sundays in YYYY-MM-DD format (e.g., library holiday closures).
   * Tip: Append `?skipNextSunday=true` to the page URL to preview the off-week footnote state.
   */
  skippedSundays: [
    // Example holiday off-weeks:
    // "2026-11-29",
    // "2026-12-27",
  ],

  /**
   * Optional per-date notes in YYYY-MM-DD format.
   * If a note exists for the upcoming meetup Sunday (either here, via Google Calendar
   * event description, or via `?note=...` in the URL), the yellow alert banner is shown.
   */
  eventNotes: {
    // Example:
    // "2026-11-15": "Meeting in the 2nd Floor Community Room this week.",
  },
};

/**
 * Formats a Date object as YYYY-MM-DD in local calendar components.
 * @param {Date} date
 * @returns {string}
 */
function toIsoDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a Date object as a human-friendly month and day (e.g., "November 8").
 * @param {Date} date
 * @returns {string}
 */
function formatMonthDay(date) {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

/**
 * Strips any HTML tags from a Google Calendar event description and trims whitespace.
 * @param {string} rawText
 * @returns {string}
 */
function cleanCalendarNote(rawText) {
  if (!rawText) {
    return "";
  }
  const doc = new DOMParser().parseFromString(rawText, "text/html");
  return (doc.body.textContent || "").trim();
}

/**
 * Calculates the immediate upcoming Sunday relative to `referenceDate`.
 * If `referenceDate` is already Sunday and before 12:00 PM, today is returned.
 * Otherwise, advances to the following Sunday.
 *
 * @param {Date} [referenceDate=new Date()]
 * @returns {Date}
 */
function getImmediateUpcomingSunday(referenceDate = new Date()) {
  const candidate = new Date(referenceDate.getTime());
  const dayOfWeek = candidate.getDay(); // 0 = Sunday

  if (dayOfWeek === 0 && candidate.getHours() < CLUB_CONFIG.endHour) {
    candidate.setHours(CLUB_CONFIG.startHour, 0, 0, 0);
    return candidate;
  }

  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  candidate.setDate(candidate.getDate() + daysUntilSunday);
  candidate.setHours(CLUB_CONFIG.startHour, 0, 0, 0);
  return candidate;
}

/**
 * Adds a specified number of weeks to a Date.
 * @param {Date} date
 * @param {number} weeks
 * @returns {Date}
 */
function addWeeks(date, weeks) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + weeks * 7);
  return result;
}

/**
 * Resolves the schedule state for the Next Meetup card using configured skipped Sundays
 * and event notes (plus URL query parameters for easy previewing).
 *
 * @param {Date} [now=new Date()]
 * @param {Set<string>} [customSkippedSet]
 * @param {Record<string, string>} [customNotesMap]
 * @returns {{ nextMeetupDate: Date, skippedSundayDate: Date | null, meetupNote: string }}
 */
function resolveScheduleState(
  now = new Date(),
  customSkippedSet = new Set(CLUB_CONFIG.skippedSundays),
  customNotesMap = CLUB_CONFIG.eventNotes,
) {
  const immediateSunday = getImmediateUpcomingSunday(now);
  const skippedSet = new Set(customSkippedSet);
  const urlParams = new URLSearchParams(window.location.search);

  // Support `?skipNextSunday=true` query parameter to preview the off-week footnote
  if (urlParams.get("skipNextSunday") === "true") {
    skippedSet.add(toIsoDateString(immediateSunday));
  }

  let nextMeetupDate = immediateSunday;
  let skippedSundayDate = null;

  if (skippedSet.has(toIsoDateString(immediateSunday))) {
    skippedSundayDate = immediateSunday;
    let candidateSunday = addWeeks(immediateSunday, 1);
    let safetyCounter = 0;
    while (skippedSet.has(toIsoDateString(candidateSunday)) && safetyCounter < 12) {
      candidateSunday = addWeeks(candidateSunday, 1);
      safetyCounter += 1;
    }
    nextMeetupDate = candidateSunday;
  }

  const nextMeetupIso = toIsoDateString(nextMeetupDate);
  const urlNote = urlParams.get("note");
  const configuredNote = customNotesMap && customNotesMap[nextMeetupIso] ? customNotesMap[nextMeetupIso] : "";
  const meetupNote = cleanCalendarNote(urlNote !== null ? urlNote : configuredNote);

  return {
    nextMeetupDate,
    skippedSundayDate,
    meetupNote,
  };
}

/**
 * Fetches upcoming Sunday events from Google Calendar API v3 when `googleCalendarApiKey` is set.
 * Extracts any event description as the note for that Sunday and detects skipped Sundays.
 *
 * @param {Date} [now=new Date()]
 * @returns {Promise<{ skippedSet: Set<string>, notesMap: Record<string, string> } | null>}
 */
async function fetchGoogleCalendarSchedule(now = new Date()) {
  if (!CLUB_CONFIG.googleCalendarApiKey) {
    return null;
  }

  const immediateSunday = getImmediateUpcomingSunday(now);
  const timeMin = new Date(immediateSunday.getTime());
  timeMin.setHours(0, 0, 0, 0);

  const timeMax = addWeeks(timeMin, 8);
  timeMax.setHours(23, 59, 59, 999);

  const encodedCalId = encodeURIComponent(CLUB_CONFIG.calendarId);
  const params = new URLSearchParams({
    key: CLUB_CONFIG.googleCalendarApiKey,
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  });

  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodedCalId}/events?${params}`);
  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const activeSundays = new Set();
  const notesMap = { ...CLUB_CONFIG.eventNotes };

  for (const item of data.items || []) {
    if (item.status === "cancelled") {
      continue;
    }
    const startRaw = item.start && (item.start.dateTime || item.start.date);
    if (!startRaw) {
      continue;
    }
    const eventDate = new Date(startRaw);
    const dateKey = toIsoDateString(eventDate);
    activeSundays.add(dateKey);

    if (item.description) {
      const note = cleanCalendarNote(item.description);
      if (note) {
        notesMap[dateKey] = note;
      }
    }
  }

  const skippedSet = new Set(CLUB_CONFIG.skippedSundays);
  for (let w = 0; w < 8; w += 1) {
    const sundayKey = toIsoDateString(addWeeks(immediateSunday, w));
    if (!activeSundays.has(sundayKey)) {
      skippedSet.add(sundayKey);
    }
  }

  return { skippedSet, notesMap };
}

/**
 * Builds a Google Calendar "Add Event" template link for a given meetup Sunday.
 * @param {Date} meetupDate
 * @returns {string}
 */
function buildGoogleCalendarEventUrl(meetupDate) {
  const datePart = toIsoDateString(meetupDate).replace(/-/g, "");
  const startTime = `${datePart}T100000`;
  const endTime = `${datePart}T120000`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "Chill Chess — Sunday Morning Chess",
    dates: `${startTime}/${endTime}`,
    ctz: CLUB_CONFIG.timeZone,
    location: `${CLUB_CONFIG.venueName}, ${CLUB_CONFIG.venueAddress}`,
    details:
      "Casual, low-stress Sunday morning chess at the South Burlington Public Library (10:00 AM – 12:00 PM). Free and open to all skill levels.",
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Applies the resolved schedule state to the DOM.
 * @param {{ nextMeetupDate: Date, skippedSundayDate: Date | null, meetupNote: string }} state
 */
function applyScheduleStateToDom(state) {
  const nextMeetupDateEl = document.getElementById("next-meetup-date");
  const footnoteContainerEl = document.getElementById("skipped-sunday-footnote");
  const skippedSundayDateEl = document.getElementById("skipped-sunday-date");
  const addToCalendarBtn = document.getElementById("add-to-calendar-btn");
  const meetupNoteEl = document.getElementById("meetup-note");
  const meetupNoteTextEl = document.getElementById("meetup-note-text");

  if (!nextMeetupDateEl) {
    return;
  }

  const { nextMeetupDate, skippedSundayDate, meetupNote } = state;

  // Update Primary Header Date: "Sunday, [Date]"
  nextMeetupDateEl.textContent = `Sunday, ${formatMonthDay(nextMeetupDate)}`;

  // Update "Add to Calendar" button for the upcoming meetup date
  if (addToCalendarBtn) {
    addToCalendarBtn.href = buildGoogleCalendarEventUrl(nextMeetupDate);
  }

  // Toggle the Dynamic Event Note Banner when a note is present for this meetup
  if (meetupNoteEl && meetupNoteTextEl) {
    if (meetupNote) {
      meetupNoteTextEl.textContent = meetupNote;
      meetupNoteEl.hidden = false;
    } else {
      meetupNoteTextEl.textContent = "";
      meetupNoteEl.hidden = true;
    }
  }

  // Toggle the Dynamic Footnote Container when an off-week is detected
  if (footnoteContainerEl && skippedSundayDateEl) {
    if (skippedSundayDate) {
      skippedSundayDateEl.textContent = formatMonthDay(skippedSundayDate);
      footnoteContainerEl.hidden = false;
    } else {
      skippedSundayDateEl.textContent = "";
      footnoteContainerEl.hidden = true;
    }
  }
}

/**
 * Renders the schedule state and optionally refreshes from Google Calendar API if configured.
 */
async function renderMeetupSchedule() {
  const now = new Date();
  applyScheduleStateToDom(resolveScheduleState(now));

  try {
    const liveSchedule = await fetchGoogleCalendarSchedule(now);
    if (liveSchedule) {
      applyScheduleStateToDom(resolveScheduleState(now, liveSchedule.skippedSet, liveSchedule.notesMap));
    }
  } catch (err) {
    console.warn("Could not fetch live Google Calendar feed, using local schedule config:", err);
  }
}

/**
 * Provides a clean visual emblem if the hero image fails to load.
 */
function initLogoFallback() {
  const logoImg = document.querySelector(".hero-logo");
  if (!logoImg) {
    return;
  }

  logoImg.addEventListener("error", () => {
    logoImg.style.display = "none";
    const container = logoImg.parentElement;
    if (container && !container.querySelector(".logo-fallback")) {
      const badge = document.createElement("div");
      badge.className = "logo-fallback";
      badge.setAttribute("aria-hidden", "true");
      badge.innerHTML = "&#9822;"; // Chess knight emblem fallback
      container.appendChild(badge);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initLogoFallback();
  renderMeetupSchedule();
});
