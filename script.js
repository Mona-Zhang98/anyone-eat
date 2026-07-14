const PROFILE_STORAGE_KEY = "anyone_eat_profile_v2";
const SUPABASE_URL = "https://jgbvnsthoniroetieifo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpnYnZuc3Rob25pcm9ldGllaWZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1OTAxMjUsImV4cCI6MjA5OTE2NjEyNX0.SUF0matM2wjnoDw3UfbO5s4U0bLGQcmSGeaF1AZa5fI";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const weekListEl = document.getElementById("weekList");
const weekRangeEl = document.getElementById("weekRange");
const nameInput = document.getElementById("nameInput");
const avatarInput = document.getElementById("avatarInput");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const editProfileBtn = document.getElementById("editProfileBtn");
const activeUserBox = document.getElementById("activeUserBox");
const profileDisplay = document.getElementById("profileDisplay");
const profileEditor = document.getElementById("profileEditor");
const dayTemplate = document.getElementById("dayTemplate");

const weekdays = ["周一", "周二", "周三", "周四", "周五"];
let weekCheckinsMap = {};
const STATUS_LUNCH = "lunch";
const STATUS_BUSY = "busy";
const STATUS_VACATION = "vacation";

function getMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEffectiveNow() {
  const now = new Date();
  const day = now.getDay(); // 5 = Friday
  const hour = now.getHours();
  const minute = now.getMinutes();
  const isAfterFridayNoon = day === 5 && (hour > 12 || (hour === 12 && minute >= 1));
  if (!isAfterFridayNoon) {
    return now;
  }
  const shifted = new Date(now);
  shifted.setDate(shifted.getDate() + 7);
  return shifted;
}

function formatDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getWeekDays() {
  const monday = getMonday(getEffectiveNow());
  const days = [];
  for (let i = 0; i < 5; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function currentWeekKey() {
  return dateKey(getMonday(getEffectiveNow()));
}

function getOrCreateUserId() {
  const key = "anyone_eat_user_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

function defaultProfile() {
  return {
    id: getOrCreateUserId(),
    name: "",
    avatar: ""
  };
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw);
    const base = defaultProfile();
    return {
      ...base,
      ...parsed,
      id: parsed.id || base.id
    };
  } catch {
    return defaultProfile();
  }
}

function saveProfileLocal() {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(state.currentUser));
}

function createAvatar(src, alt) {
  const img = document.createElement("img");
  img.className = "avatar";
  img.src = src || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='100%25' height='100%25' fill='%23ffd6ea'/%3E%3Ctext x='50%25' y='56%25' dominant-baseline='middle' text-anchor='middle' font-size='36'%3E%F0%9F%8D%B1%3C/text%3E%3C/svg%3E";
  img.alt = alt || "头像";
  return img;
}

function renderActiveUser() {
  const { name, avatar } = state.currentUser;
  activeUserBox.innerHTML = "";
  if (!name.trim()) {
    profileDisplay.classList.add("hidden");
    profileEditor.classList.remove("hidden");
    return;
  }
  profileDisplay.classList.remove("hidden");
  profileEditor.classList.add("hidden");
  const chip = document.createElement("span");
  chip.className = "user-chip";
  chip.appendChild(createAvatar(avatar, name));
  const text = document.createElement("span");
  text.textContent = name;
  chip.appendChild(text);
  activeUserBox.appendChild(chip);
}

function renderUsers(container, users) {
  container.innerHTML = "";
  if (!users.length) {
    const empty = document.createElement("span");
    empty.className = "empty-text";
    empty.textContent = "还没有人打卡";
    container.appendChild(empty);
    return;
  }

  users.forEach((u) => {
    const chip = document.createElement("span");
    chip.className = "user-chip";
    chip.appendChild(createAvatar(u.avatar_url, u.user_name));
    const name = document.createElement("span");
    name.textContent = u.user_name;
    chip.appendChild(name);
    container.appendChild(chip);
  });
}

function splitByStatus(users) {
  const result = {
    lunch: [],
    busy: [],
    vacation: []
  };
  users.forEach((u) => {
    const status = u.check_status || STATUS_LUNCH;
    if (status === STATUS_VACATION) {
      result.vacation.push(u);
    } else if (status === STATUS_BUSY) {
      result.busy.push(u);
    } else {
      result.lunch.push(u);
    }
  });
  return result;
}

function renderWeek() {
  const days = getWeekDays();
  const first = formatDate(days[0]);
  const last = formatDate(days[4]);
  weekRangeEl.textContent = `${first} - ${last}`;
  weekListEl.innerHTML = "";

  days.forEach((date, i) => {
    const key = dateKey(date);
    const users = weekCheckinsMap[key] || [];
    const fragment = dayTemplate.content.cloneNode(true);
    const dayItem = fragment.querySelector(".day-item");
    const title = fragment.querySelector(".day-title");
    const subtitle = fragment.querySelector(".day-subtitle");
    const vacationBtn = fragment.querySelector(".vacation-btn");
    const lunchBtn = fragment.querySelector(".lunch-btn");
    const busyBtn = fragment.querySelector(".busy-btn");
    const vacationUsersEl = fragment.querySelector(".vacation-users");
    const lunchUsersEl = fragment.querySelector(".lunch-users");
    const busyUsersEl = fragment.querySelector(".busy-users");

    title.textContent = `${formatDate(date)} ${weekdays[i]}`;
    subtitle.textContent = "午饭团打卡";

    const grouped = splitByStatus(users);
    const meRecord = users.find((u) => u.user_id === state.currentUser.id);

    if (meRecord && (meRecord.check_status || STATUS_LUNCH) === STATUS_VACATION) {
      vacationBtn.classList.add("checked");
      vacationBtn.textContent = "已休假（再点取消）";
    }
    if (meRecord && (meRecord.check_status || STATUS_LUNCH) === STATUS_LUNCH) {
      lunchBtn.classList.add("checked");
      lunchBtn.textContent = "已打卡（再点取消）";
    }
    if (meRecord && (meRecord.check_status || STATUS_LUNCH) === STATUS_BUSY) {
      busyBtn.classList.add("checked");
      busyBtn.textContent = "已有约（再点取消）";
    }
    vacationBtn.addEventListener("click", () => {
      toggleCheckIn(key, STATUS_VACATION).catch(() => {
        alert("打卡失败，请稍后重试。");
      });
    });
    lunchBtn.addEventListener("click", () => {
      toggleCheckIn(key, STATUS_LUNCH).catch(() => {
        alert("打卡失败，请稍后重试。");
      });
    });
    busyBtn.addEventListener("click", () => {
      toggleCheckIn(key, STATUS_BUSY).catch(() => {
        alert("打卡失败，请稍后重试。");
      });
    });

    renderUsers(vacationUsersEl, grouped.vacation);
    renderUsers(lunchUsersEl, grouped.lunch);
    renderUsers(busyUsersEl, grouped.busy);
    weekListEl.appendChild(dayItem);
  });
}

function rebuildWeekMap(rows) {
  const map = {};
  rows.forEach((row) => {
    if (!map[row.check_date]) {
      map[row.check_date] = [];
    }
    map[row.check_date].push(row);
  });
  weekCheckinsMap = map;
}

async function loadWeekCheckins() {
  const days = getWeekDays();
  const start = dateKey(days[0]);
  const end = dateKey(days[4]);

  const { data, error } = await supabaseClient
    .from("lunch_checkins")
    .select("id, week_key, check_date, user_id, user_name, avatar_url, check_status, created_at")
    .eq("week_key", currentWeekKey())
    .gte("check_date", start)
    .lte("check_date", end)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  rebuildWeekMap(data || []);
  renderWeek();
}

async function toggleCheckIn(dayKey, targetStatus) {
  const name = state.currentUser.name.trim();
  if (!name) {
    alert("请先在“创建用户”里保存名字。");
    return;
  }

  const users = weekCheckinsMap[dayKey] || [];
  const existing = users.find((u) => u.user_id === state.currentUser.id);
  const existingStatus = existing ? (existing.check_status || STATUS_LUNCH) : null;

  if (existing && existingStatus === targetStatus) {
    const { error } = await supabaseClient
      .from("lunch_checkins")
      .delete()
      .eq("check_date", dayKey)
      .eq("user_id", state.currentUser.id);
    if (error) {
      throw error;
    }
  } else {
    if (existing && existingStatus !== targetStatus) {
      const { error: deleteError } = await supabaseClient
        .from("lunch_checkins")
        .delete()
        .eq("check_date", dayKey)
        .eq("user_id", state.currentUser.id);
      if (deleteError) {
        throw deleteError;
      }
    }

    const payload = {
      week_key: currentWeekKey(),
      check_date: dayKey,
      user_id: state.currentUser.id,
      user_name: state.currentUser.name.trim(),
      avatar_url: state.currentUser.avatar || "",
      check_status: targetStatus
    };
    const { error } = await supabaseClient
      .from("lunch_checkins")
      .insert(payload);
    if (error) {
      throw error;
    }
  }

  await loadWeekCheckins();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveProfile() {
  const name = nameInput.value.trim();
  if (!name) {
    alert("请输入名字。");
    return;
  }

  state.currentUser.name = name;

  const file = avatarInput.files[0];
  if (file) {
    const dataUrl = await fileToDataUrl(file);
    state.currentUser.avatar = dataUrl;
  }

  saveProfileLocal();
  renderActiveUser();
  renderWeek();
}

function subscribeRealtime() {
  supabaseClient
    .channel("lunch-checkins-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "lunch_checkins" },
      () => {
        loadWeekCheckins().catch(() => {});
      }
    )
    .subscribe();
}

saveProfileBtn.addEventListener("click", () => {
  saveProfile().catch(() => {
    alert("头像保存失败，请重试。");
  });
});

editProfileBtn.addEventListener("click", () => {
  profileDisplay.classList.add("hidden");
  profileEditor.classList.remove("hidden");
  nameInput.focus();
});

const state = {
  currentUser: loadProfile()
};

nameInput.value = state.currentUser.name || "";
renderActiveUser();
renderWeek();

loadWeekCheckins().catch(() => {
  alert("连接数据库失败，请确认 Supabase 表和权限策略已创建。");
});
subscribeRealtime();
