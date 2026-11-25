/**
 * Chill Chess — Dynamic Schedule & UI Controller
 *
 * Calculates the next upcoming Sunday session (10:00 AM – 12:00 PM ET),
 * parses the synced `calendar.ics` feed (and optional Google Calendar API),
 * detects skipped/canceled Sundays for the off-week footnote, and displays
 * any event description as a prominent alert note on the Next Meetup card.
 */

const CLUB_CONFIG = {
  calendarId: "chillchess802@gmail.com",
  icsFeedPath: "calendar.ics",
  googleCalendarApiKey: "",
  publicCalendarUrl:
    "https://calendar.google.com/calendar/embed?src=chillchess802%40gmail.com&ctz=America%2FNew_York",
  timeZone: "America/New_York",
  startHour: 10, // 10:00 AM
  endHour: 12, // 12:00 PM
  venueName: "South Burlington Public Library",
  venueAddress: "180 Market Street, South Burlington, VT 05403",

  /**
   * Fallback list of skipped Sundays in YYYY-MM-DD format if `calendar.ics` has not loaded yet.
   * Tip: Append `?skipNextSunday=true` to the page URL to preview the off-week footnote state.
   */
  skippedSundays: ["2026-11-29", "2026-12-27"],

  /**
   * Optional manual per-date notes in YYYY-MM-DD format (merged with notes parsed from `calendar.ics`).
   * Tip: Append `?note=Your+note+here` to the page URL to preview the yellow note banner.
   */
  eventNotes: {},
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
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(rawText, "text/html");
    return (doc.body.textContent || "").trim();
  }
  return rawText.replace(/<[^>]*>/g, "").trim();
}

/**
 * Unescapes RFC 5545 text escapes (\n, \,, \;, \\).
 * @param {string} val
 * @returns {string}
 */
function unescapeIcsText(val) {
  return val
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Parses an ICS date/datetime value (e.g., "20261122T100000" or "20261108T150000Z")
 * into `{ dateKey: "YYYY-MM-DD", dateObj: Date }`.
 *
 * @param {string} rawValue
 * @returns {{ dateKey: string, dateObj: Date } | null}
 */
function parseIcsDateTime(rawValue) {
  if (!rawValue) {
    return null;
  }
  const val = rawValue.trim();
  const match = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) {
    return null;
  }

  const [, yearStr, monthStr, dayStr, hourStr, minStr, secStr, isUtc] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (isUtc) {
    const utcDate = new Date(Date.UTC(year, month - 1, day, Number(hourStr), Number(minStr), Number(secStr)));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: CLUB_CONFIG.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(utcDate);
    const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return {
      dateKey: `${partMap.year}-${partMap.month}-${partMap.day}`,
      dateObj: utcDate,
    };
  }

  const localDate = new Date(
    year,
    month - 1,
    day,
    hourStr ? Number(hourStr) : CLUB_CONFIG.startHour,
    minStr ? Number(minStr) : 0,
    secStr ? Number(secStr) : 0,
  );
  return {
    dateKey: `${yearStr}-${monthStr}-${dayStr}`,
    dateObj: localDate,
  };
}

/**
 * Parses an RFC 5545 `.ics` calendar string to extract skipped Sundays (`EXDATE` / cancelled events)
 * and per-Sunday event notes (`DESCRIPTION`).
 *
 * @param {string} icsText
 * @param {Date} [now=new Date()]
 * @returns {{ skippedSet: Set<string>, notesMap: Record<string, string> }}
 */
function parseIcsSchedule(icsText, now = new Date()) {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  const exdates = new Set();
  const activeSingleDates = new Set();
  const recurringSeries = [];
  const notesMap = { ...CLUB_CONFIG.eventNotes };

  let currentEvent = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      currentEvent = { exdates: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (currentEvent) {
        for (const ex of currentEvent.exdates) {
          exdates.add(ex);
        }

        const startInfo = parseIcsDateTime(currentEvent.dtstart);
        if (startInfo) {
          if (currentEvent.status === "CANCELLED") {
            exdates.add(startInfo.dateKey);
          } else {
            if (currentEvent.rrule && currentEvent.rrule.includes("FREQ=WEEKLY")) {
              const untilMatch = currentEvent.rrule.match(/UNTIL=(\d{8}(?:T\d{6}Z?)?)/);
              const untilInfo = untilMatch ? parseIcsDateTime(untilMatch[1]) : null;
              recurringSeries.push({
                startDateKey: startInfo.dateKey,
                untilDateKey: untilInfo ? untilInfo.dateKey : "2099-12-31",
                description: currentEvent.description || "",
              });
            } else {
              activeSingleDates.add(startInfo.dateKey);
            }

            if (currentEvent.description) {
              const cleaned = cleanCalendarNote(unescapeIcsText(currentEvent.description));
              if (cleaned) {
                notesMap[startInfo.dateKey] = cleaned;
              }
            }
          }
        }
      }
      currentEvent = null;
      continue;
    }

    if (!currentEvent) {
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }
    const rawKey = line.slice(0, colonIdx);
    const propName = rawKey.split(";")[0].toUpperCase();
    const propVal = line.slice(colonIdx + 1);

    if (propName === "DTSTART") {
      currentEvent.dtstart = propVal;
    } else if (propName === "DTEND") {
      currentEvent.dtend = propVal;
    } else if (propName === "RRULE") {
      currentEvent.rrule = propVal;
    } else if (propName === "STATUS") {
      currentEvent.status = propVal.trim().toUpperCase();
    } else if (propName === "DESCRIPTION") {
      currentEvent.description = propVal;
    } else if (propName === "EXDATE") {
      for (const part of propVal.split(",")) {
        const parsedEx = parseIcsDateTime(part);
        if (parsedEx) {
          currentEvent.exdates.push(parsedEx.dateKey);
        }
      }
    }
  }

  // Determine which upcoming Sundays over the next 12 weeks are skipped
  const skippedSet = new Set(exdates);
  const immediateSunday = getImmediateUpcomingSunday(now);

  for (let w = 0; w < 12; w += 1) {
    const sundayKey = toIsoDateString(addWeeks(immediateSunday, w));
    if (exdates.has(sundayKey)) {
      skippedSet.add(sundayKey);
      continue;
    }

    const coveredBySingle = activeSingleDates.has(sundayKey);
    const coveredByRecurring = recurringSeries.some(
      (series) => sundayKey >= series.startDateKey && sundayKey <= series.untilDateKey,
    );

    if ((activeSingleDates.size > 0 || recurringSeries.length > 0) && !coveredBySingle && !coveredByRecurring) {
      skippedSet.add(sundayKey);
    }

    // Apply recurring series note if no single-event override note exists
    if (!notesMap[sundayKey]) {
      const seriesWithNote = recurringSeries.find(
        (series) => sundayKey >= series.startDateKey && sundayKey <= series.untilDateKey && series.description,
      );
      if (seriesWithNote) {
        const cleaned = cleanCalendarNote(unescapeIcsText(seriesWithNote.description));
        if (cleaned) {
          notesMap[sundayKey] = cleaned;
        }
      }
    }
  }

  return { skippedSet, notesMap };
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
 * Resolves the schedule state for the Next Meetup card using configured or parsed skipped Sundays
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
  const searchStr = typeof window !== "undefined" && window.location ? window.location.search : "";
  const urlParams = new URLSearchParams(searchStr);

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
  const calendarEntryNote = cleanCalendarNote(urlNote !== null ? urlNote : configuredNote);

  let meetupNote = calendarEntryNote;
  if (!meetupNote && skippedSundayDate) {
    meetupNote = `There will be no meeting on Sunday, ${formatMonthDay(skippedSundayDate)}.`;
  }

  return {
    nextMeetupDate,
    skippedSundayDate,
    meetupNote,
  };
}

/**
 * Fetches the repository's synced `calendar.ics` file (updated by GitHub Actions).
 *
 * @param {Date} [now=new Date()]
 * @returns {Promise<{ skippedSet: Set<string>, notesMap: Record<string, string> } | null>}
 */
async function fetchSyncedIcsSchedule(now = new Date()) {
  if (!CLUB_CONFIG.icsFeedPath) {
    return null;
  }

  const cacheBuster = Math.floor(Date.now() / 60000); // Bust browser cache every minute
  const response = await fetch(`${CLUB_CONFIG.icsFeedPath}?v=${cacheBuster}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  const icsText = await response.text();
  if (!icsText.includes("BEGIN:VCALENDAR")) {
    return null;
  }

  return parseIcsSchedule(icsText, now);
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
  const addToCalendarBtn = document.getElementById("add-to-calendar-btn");
  const meetupNoteEl = document.getElementById("meetup-note");
  const meetupNoteTextEl = document.getElementById("meetup-note-text");

  if (!nextMeetupDateEl) {
    return;
  }

  const { nextMeetupDate, meetupNote } = state;

  // Update Primary Header Date: "Sunday, [Date]"
  nextMeetupDateEl.textContent = `Sunday, ${formatMonthDay(nextMeetupDate)}`;

  // Update "Add to Calendar" button for the upcoming meetup date
  if (addToCalendarBtn) {
    addToCalendarBtn.href = buildGoogleCalendarEventUrl(nextMeetupDate);
  }

  // Toggle the Dynamic Event Note Banner when a calendar note or skipped-Sunday notice is present
  if (meetupNoteEl && meetupNoteTextEl) {
    if (meetupNote) {
      meetupNoteTextEl.textContent = meetupNote;
      meetupNoteEl.hidden = false;
    } else {
      meetupNoteTextEl.textContent = "";
      meetupNoteEl.hidden = true;
    }
  }
}

/**
 * Renders the schedule state and refreshes from the synced `calendar.ics` feed.
 */
async function renderMeetupSchedule() {
  const now = new Date();
  applyScheduleStateToDom(resolveScheduleState(now));

  try {
    const icsSchedule = await fetchSyncedIcsSchedule(now);
    if (icsSchedule) {
      applyScheduleStateToDom(resolveScheduleState(now, icsSchedule.skippedSet, icsSchedule.notesMap));
    }
  } catch (err) {
    console.warn("Could not load calendar.ics, using fallback schedule config:", err);
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

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initLogoFallback();
    renderMeetupSchedule();
  });
}
