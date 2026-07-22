const PROFILE_STORAGE_KEY = "anyone_eat_profile_v2";
const USER_ID_STORAGE_KEY = "anyone_eat_user_id";
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
const profileEditorTitle = document.getElementById("profileEditorTitle");
const profileHelp = document.getElementById("profileHelp");
const profileStatus = document.getElementById("profileStatus");
const switchProfileBtn = document.getElementById("switchProfileBtn");
const dayTemplate = document.getElementById("dayTemplate");
const dogCelebrationEl = document.getElementById("dogCelebration");
const dogMessageEl = document.getElementById("dogMessage");

const weekdays = ["周一", "周二", "周三", "周四", "周五"];
let weekCheckinsMap = {};
const STATUS_LUNCH = "lunch";
const STATUS_BUSY = "busy";
const STATUS_VACATION = "vacation";
const FALLBACK_REFRESH_MS = 8000;
const pendingCheckins = new Set();
const localSyncChannel = "BroadcastChannel" in window
  ? new BroadcastChannel("anyone-eat-checkins")
  : null;
let loadRequestId = 0;
let refreshTimer = null;
let dogAnimationTimer = null;

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
  const existing = localStorage.getItem(USER_ID_STORAGE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(USER_ID_STORAGE_KEY, created);
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
    if (parsed.id) {
      localStorage.setItem(USER_ID_STORAGE_KEY, parsed.id);
    }
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
  localStorage.setItem(USER_ID_STORAGE_KEY, state.currentUser.id);
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(state.currentUser));
}

function normalizeUserName(name) {
  return name.trim().toLowerCase();
}

function profileFromRow(row) {
  return {
    id: row.user_id,
    name: row.user_name,
    avatar: row.avatar_url || ""
  };
}

function setProfileStatus(message = "", type = "") {
  profileStatus.textContent = message;
  profileStatus.className = `profile-status${type ? ` ${type}` : ""}`;
}

function isMissingProfilesTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function friendlyProfileError(error) {
  if (isMissingProfilesTable(error)) {
    return "用户资料表尚未配置，请先在 Supabase 运行 supabase_profiles.sql。";
  }
  if (error?.code === "23505") {
    return "这个用户名已经被使用，请换一个名字。";
  }
  return "用户资料保存失败，请稍后重试。";
}

function createAvatar(src, alt) {
  const img = document.createElement("img");
  img.className = "avatar";
  img.src = src || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='100%25' height='100%25' fill='%23ffd6ea'/%3E%3Ctext x='50%25' y='56%25' dominant-baseline='middle' text-anchor='middle' font-size='36'%3E%F0%9F%8D%B1%3C/text%3E%3C/svg%3E";
  img.alt = alt || "头像";
  return img;
}

function openProfileEditor(editing = false) {
  profileDisplay.classList.add("hidden");
  profileEditor.classList.remove("hidden");
  profileEditorTitle.textContent = editing ? "修改用户资料" : "登录或创建用户";
  profileHelp.textContent = editing
    ? "修改名字或头像不会改变你的 user_id，历史打卡会自动同步。"
    : "输入已有用户名会恢复原账户；输入新名字会创建用户。";
  saveProfileBtn.textContent = editing ? "保存修改" : "继续";
}

function renderActiveUser() {
  const { name, avatar } = state.currentUser;
  activeUserBox.innerHTML = "";
  if (!name.trim()) {
    openProfileEditor(false);
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

function setCheckButtonState(button, isChecked, checkedTitle) {
  button.classList.toggle("checked", isChecked);
  button.setAttribute("aria-pressed", String(isChecked));
  button.title = isChecked ? checkedTitle : "点击打卡";
}

function showDogCelebration(status) {
  const messages = {
    [STATUS_LUNCH]: "YAY!",
    [STATUS_BUSY]: "好吧...",
    [STATUS_VACATION]: "你要去哪里玩!"
  };

  window.clearTimeout(dogAnimationTimer);
  dogCelebrationEl.hidden = true;
  dogCelebrationEl.className = `dog-celebration dog-${status}`;
  dogMessageEl.textContent = messages[status];
  void dogCelebrationEl.offsetWidth;
  dogCelebrationEl.hidden = false;

  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1100 : 1750;
  dogAnimationTimer = window.setTimeout(() => {
    dogCelebrationEl.hidden = true;
  }, duration);
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
    const meStatus = meRecord ? (meRecord.check_status || STATUS_LUNCH) : null;
    const isPending = pendingCheckins.has(dayKeyForUser(key));

    setCheckButtonState(vacationBtn, meStatus === STATUS_VACATION, "已休假，再点一次取消");
    setCheckButtonState(lunchBtn, meStatus === STATUS_LUNCH, "已打卡，再点一次取消");
    setCheckButtonState(busyBtn, meStatus === STATUS_BUSY, "已有约，再点一次取消");
    vacationBtn.disabled = isPending;
    lunchBtn.disabled = isPending;
    busyBtn.disabled = isPending;
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
  const requestId = ++loadRequestId;
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

  if (requestId !== loadRequestId) {
    return;
  }

  rebuildWeekMap(data || []);
  renderWeek();
}

function dayKeyForUser(dayKey) {
  return `${dayKey}:${state.currentUser.id}`;
}

function applyOptimisticCheckin(dayKey, targetStatus, shouldRemove) {
  const currentUsers = weekCheckinsMap[dayKey] || [];
  const otherUsers = currentUsers.filter((user) => user.user_id !== state.currentUser.id);

  weekCheckinsMap = {
    ...weekCheckinsMap,
    [dayKey]: shouldRemove
      ? otherUsers
      : [
          ...otherUsers,
          {
            id: `optimistic-${state.currentUser.id}-${dayKey}`,
            week_key: currentWeekKey(),
            check_date: dayKey,
            user_id: state.currentUser.id,
            user_name: state.currentUser.name.trim(),
            avatar_url: state.currentUser.avatar || "",
            check_status: targetStatus,
            created_at: new Date().toISOString()
          }
        ]
  };
  renderWeek();
}

function scheduleWeekRefresh(delay = 120) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    if (pendingCheckins.size > 0) {
      scheduleWeekRefresh(250);
      return;
    }
    loadWeekCheckins().catch((error) => {
      console.warn("同步打卡数据失败，将在下一次自动刷新时重试。", error);
    });
  }, delay);
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
  const pendingKey = dayKeyForUser(dayKey);
  const shouldRemove = Boolean(existing && existingStatus === targetStatus);
  const previousUsers = [...users];

  if (pendingCheckins.has(pendingKey)) {
    return;
  }

  pendingCheckins.add(pendingKey);
  loadRequestId += 1;
  applyOptimisticCheckin(dayKey, targetStatus, shouldRemove);

  try {
    if (shouldRemove) {
      const { error } = await supabaseClient
        .from("lunch_checkins")
        .delete()
        .eq("check_date", dayKey)
        .eq("user_id", state.currentUser.id);
      if (error) {
        throw error;
      }
    } else {
      const payload = {
        week_key: currentWeekKey(),
        check_date: dayKey,
        user_id: state.currentUser.id,
        user_name: state.currentUser.name.trim(),
        avatar_url: state.currentUser.avatar || "",
        check_status: targetStatus
      };

      const query = existing
        ? supabaseClient
            .from("lunch_checkins")
            .update(payload)
            .eq("check_date", dayKey)
            .eq("user_id", state.currentUser.id)
        : supabaseClient.from("lunch_checkins").insert(payload);
      const { error } = await query;
      if (error) {
        throw error;
      }
    }

    pendingCheckins.delete(pendingKey);
    renderWeek();
    localSyncChannel?.postMessage({ type: "checkin-changed" });
    scheduleWeekRefresh();
    if (!shouldRemove) {
      showDogCelebration(targetStatus);
    }
  } catch (error) {
    pendingCheckins.delete(pendingKey);
    weekCheckinsMap = {
      ...weekCheckinsMap,
      [dayKey]: previousUsers
    };
    renderWeek();
    throw error;
  }
}

async function findProfileByName(name) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("user_id, user_name, user_name_key, avatar_url, updated_at")
    .eq("user_name_key", normalizeUserName(name))
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

async function findProfileById(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("user_id, user_name, user_name_key, avatar_url, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

async function upsertProfile(profile) {
  const { error } = await supabaseClient
    .from("profiles")
    .upsert(
      {
        user_id: profile.id,
        user_name: profile.name.trim(),
        avatar_url: profile.avatar || ""
      },
      { onConflict: "user_id" }
    );

  if (error) {
    throw error;
  }
}

function updateProfileInWeekMap(profile) {
  const nextMap = {};
  Object.entries(weekCheckinsMap).forEach(([dayKey, users]) => {
    nextMap[dayKey] = users.map((user) => (
      user.user_id === profile.id
        ? {
            ...user,
            user_name: profile.name,
            avatar_url: profile.avatar || ""
          }
        : user
    ));
  });
  weekCheckinsMap = nextMap;
}

function adoptProfile(row, message = "") {
  state.currentUser = profileFromRow(row);
  saveProfileLocal();
  nameInput.value = state.currentUser.name;
  avatarInput.value = "";
  updateProfileInWeekMap(state.currentUser);
  renderActiveUser();
  renderWeek();
  setProfileStatus(message, message ? "success" : "");
}

function applyRemoteProfile(row) {
  const editorIsOpen = !profileEditor.classList.contains("hidden");
  state.currentUser = profileFromRow(row);
  saveProfileLocal();
  updateProfileInWeekMap(state.currentUser);

  if (!editorIsOpen) {
    nameInput.value = state.currentUser.name;
    renderActiveUser();
  }
  renderWeek();
}

async function refreshCurrentProfile() {
  if (!state.currentUser.name.trim()) {
    return;
  }
  const remoteProfile = await findProfileById(state.currentUser.id);
  if (remoteProfile) {
    applyRemoteProfile(remoteProfile);
  }
}

async function initializeProfile() {
  try {
    if (!state.currentUser.name.trim()) {
      const remoteProfile = await findProfileById(state.currentUser.id);
      if (remoteProfile) {
        adoptProfile(remoteProfile);
      }
      return;
    }

    const remoteProfile = await findProfileById(state.currentUser.id);
    if (remoteProfile) {
      adoptProfile(remoteProfile);
      return;
    }

    await upsertProfile(state.currentUser);
  } catch (error) {
    console.warn("用户资料后端同步暂不可用。", error);
    setProfileStatus(friendlyProfileError(error), "error");
  }
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
    setProfileStatus("请输入用户名。", "error");
    return;
  }

  saveProfileBtn.disabled = true;
  setProfileStatus("正在连接用户资料...", "");

  try {
    const isEditing = Boolean(state.currentUser.name.trim());

    if (!isEditing) {
      const existingProfile = await findProfileByName(name);
      if (existingProfile) {
        adoptProfile(existingProfile, `欢迎回来，${existingProfile.user_name}。`);
        scheduleWeekRefresh(0);
        localSyncChannel?.postMessage({ type: "profile-changed" });
        return;
      }
    }

    let avatar = state.currentUser.avatar || "";
    const file = avatarInput.files[0];
    if (file) {
      avatar = await fileToDataUrl(file);
    }

    const nextProfile = {
      id: state.currentUser.id,
      name,
      avatar
    };

    await upsertProfile(nextProfile);
    state.currentUser = nextProfile;
    saveProfileLocal();
    avatarInput.value = "";
    updateProfileInWeekMap(nextProfile);
    renderActiveUser();
    renderWeek();
    localSyncChannel?.postMessage({ type: "profile-changed" });
    scheduleWeekRefresh(0);
  } catch (error) {
    console.error("保存用户资料失败。", error);
    setProfileStatus(friendlyProfileError(error), "error");
  } finally {
    saveProfileBtn.disabled = false;
  }
}

function subscribeRealtime() {
  supabaseClient
    .channel("lunch-checkins-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "lunch_checkins" },
      () => {
        scheduleWeekRefresh();
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        scheduleWeekRefresh(0);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        scheduleWeekRefresh(500);
      }
    });

  supabaseClient
    .channel("profiles-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "profiles" },
      (payload) => {
        if (payload.new?.user_id === state.currentUser.id) {
          applyRemoteProfile(payload.new);
        }
        scheduleWeekRefresh();
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        refreshCurrentProfile().catch(() => {});
      }
    });
}

localSyncChannel?.addEventListener("message", (event) => {
  if (event.data?.type === "profile-changed") {
    refreshCurrentProfile().catch(() => {});
  }
  scheduleWeekRefresh(0);
});

window.addEventListener("focus", () => {
  scheduleWeekRefresh(0);
  refreshCurrentProfile().catch(() => {});
});

window.addEventListener("online", () => {
  scheduleWeekRefresh(0);
  refreshCurrentProfile().catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    scheduleWeekRefresh(0);
    refreshCurrentProfile().catch(() => {});
  }
});

window.setInterval(() => {
  if (document.visibilityState === "visible") {
    scheduleWeekRefresh(0);
  }
}, FALLBACK_REFRESH_MS);

saveProfileBtn.addEventListener("click", () => {
  saveProfile();
});

nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveProfile();
  }
});

editProfileBtn.addEventListener("click", () => {
  nameInput.value = state.currentUser.name;
  setProfileStatus();
  openProfileEditor(true);
  nameInput.focus();
});

switchProfileBtn.addEventListener("click", () => {
  const shouldSwitch = window.confirm("切换只会退出当前浏览器中的用户，不会删除后端资料和打卡记录。继续吗？");
  if (!shouldSwitch) {
    return;
  }

  localStorage.removeItem(PROFILE_STORAGE_KEY);
  localStorage.removeItem(USER_ID_STORAGE_KEY);
  state.currentUser = defaultProfile();
  nameInput.value = "";
  avatarInput.value = "";
  setProfileStatus();
  renderActiveUser();
  renderWeek();
  nameInput.focus();
});

const state = {
  currentUser: loadProfile()
};

nameInput.value = state.currentUser.name || "";
renderActiveUser();
renderWeek();
initializeProfile();

loadWeekCheckins().catch(() => {
  alert("连接数据库失败，请确认 Supabase 表和权限策略已创建。");
});
subscribeRealtime();
