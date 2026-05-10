const { formatInTimeZone, toZonedTime } = require('date-fns-tz');
const { differenceInHours, differenceInDays, isToday } = require('date-fns');

const TZ = process.env.TZ || 'America/Santiago';

function nowInChile() {
  return toZonedTime(new Date(), TZ);
}

function formatChile(date, fmt = "yyyy-MM-dd'T'HH:mm:ssxxx") {
  return formatInTimeZone(date instanceof Date ? date : new Date(date), TZ, fmt);
}

function timeOnlyChile(date) {
  return formatInTimeZone(date instanceof Date ? date : new Date(date), TZ, 'HH:mm');
}

function isMorningNow() {
  const hour = nowInChile().getHours();
  return hour >= 0 && hour < 14;
}

function ageHours(dateStr) {
  return differenceInHours(new Date(), new Date(dateStr));
}

function ageDays(dateStr) {
  return differenceInDays(new Date(), new Date(dateStr));
}

function isTodayDate(dateStr) {
  return isToday(toZonedTime(new Date(dateStr), TZ));
}

module.exports = { TZ, nowInChile, formatChile, timeOnlyChile, isMorningNow, ageHours, ageDays, isTodayDate };
