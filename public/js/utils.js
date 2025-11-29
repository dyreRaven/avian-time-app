
/* ───────── 1. CORE HELPERS ───────── */

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.message || 'Request failed';
    throw new Error(msg);
  }
  return data;
}

function formatDateTimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// Safely escape text for insertion into HTML attributes / text nodes
function escapeHTML(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


function formatDateUS(dateInput) {
  if (!dateInput) return '';

  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return dateInput; // fallback if it's not a real date

  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

function formatHoursMinutes(hours) {
  const totalMinutes = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  if (h > 0 && m > 0) {
    return `${h} hr${h !== 1 ? 's' : ''} ${m} min`;
  }
  if (h > 0) {
    return `${h} hr${h !== 1 ? 's' : ''}`;
  }
  return `${m} min`;
}

function formatMoney(value) {
  const num = Number(value) || 0;
  return '$' + num.toFixed(2);
}

function computeHoursFromDateTimes(startDate, startTime, endDate, endTime) {
  if (!startDate || !startTime || !endDate || !endTime) {
    return null;
  }

  // Build ISO-like strings: "YYYY-MM-DDTHH:MM:00"
  const start = new Date(`${startDate}T${startTime}:00`);
  const end   = new Date(`${endDate}T${endTime}:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const diffMs = end - start;
  if (diffMs <= 0) {
    // end must be after start
    return null;
  }

  // Round **up** to the nearest minute (matches kiosk punch logic)
  const minutes = Math.ceil(diffMs / 60000);
  const hours   = minutes / 60;

  return hours;
}
