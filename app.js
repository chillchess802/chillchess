/**
 * Chill Chess — Dynamic Schedule & UI Controller
 *
 * Calculates the next upcoming Sunday session (10:00 AM – 12:00 PM ET),
 * supports skipped/holiday off-week detection with a conditional footnote,
 * and is structured to plug directly into a Google Calendar feed.
 */

const CLUB_CONFIG = {
  calendarId: "chillchess802@gmail.com",
  publicCalendarUrl:
    "https://calendar.google.com/calendar/embed?src=chillchess802%40gmail.com&ctz=America%2FNew_York",
  timeZone: "America/New_York",
  startHour: 10, // 10:00 AM
  endHour: 12, // 12:00 PM
  venueName: "South Burlington Public Library",
  venueAddress: "180 Market Street, South Burlington, VT 05403",

  /**
   * Placeholder list of skipped Sundays in YYYY-MM-DD format (e.g., library holiday closures).
   * When a Google Calendar API or ICS feed is connected, populate or replace this set
   * with Sundays that have no scheduled "Chill Chess" event.
   *
   * Tip: Append `?skipNextSunday=true` to the page URL to preview the off-week footnote state.
   */
  skippedSundays: [
    // Example holiday off-weeks:
    // "2026-11-29",
    // "2026-12-27",
  ],
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
 * Resolves the schedule state for the Next Meetup card.
 * Checks whether the immediate upcoming Sunday is skipped (via config, URL param,
 * or future Google Calendar feed integration) and finds the next active meetup Sunday.
 *
 * @param {Date} [now=new Date()]
 * @returns {{ nextMeetupDate: Date, skippedSundayDate: Date | null }}
 */
function resolveScheduleState(now = new Date()) {
  const immediateSunday = getImmediateUpcomingSunday(now);
  const skippedSet = new Set(CLUB_CONFIG.skippedSundays);

  // Support `?skipNextSunday=true` query parameter to easily preview the off-week footnote
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("skipNextSunday") === "true") {
    skippedSet.add(toIsoDateString(immediateSunday));
  }

  if (!skippedSet.has(toIsoDateString(immediateSunday))) {
    return {
      nextMeetupDate: immediateSunday,
      skippedSundayDate: null,
    };
  }

  // Advance week-by-week until the next non-skipped Sunday is found
  let candidateSunday = addWeeks(immediateSunday, 1);
  let safetyCounter = 0;
  while (skippedSet.has(toIsoDateString(candidateSunday)) && safetyCounter < 12) {
    candidateSunday = addWeeks(candidateSunday, 1);
    safetyCounter += 1;
  }

  return {
    nextMeetupDate: candidateSunday,
    skippedSundayDate: immediateSunday,
  };
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
 * Renders the resolved schedule state into the Next Meetup card and conditional footnote.
 */
function renderMeetupSchedule() {
  const nextMeetupDateEl = document.getElementById("next-meetup-date");
  const footnoteContainerEl = document.getElementById("skipped-sunday-footnote");
  const skippedSundayDateEl = document.getElementById("skipped-sunday-date");
  const addToCalendarBtn = document.getElementById("add-to-calendar-btn");

  if (!nextMeetupDateEl) {
    return;
  }

  const { nextMeetupDate, skippedSundayDate } = resolveScheduleState();

  // Update Primary Header Date: "Sunday, [Date]"
  nextMeetupDateEl.textContent = `Sunday, ${formatMonthDay(nextMeetupDate)}`;

  // Update "Add to Calendar" button for the upcoming meetup date
  if (addToCalendarBtn) {
    addToCalendarBtn.href = buildGoogleCalendarEventUrl(nextMeetupDate);
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
 * Provides a clean visual emblem if `logo.png` has not yet been dropped into the root directory.
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
