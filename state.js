// Shared, mutable app state. Exported as a single object (rather than individual
// `let` bindings) because ES module imports are read-only live bindings — a module
// that imports `{ currentUser }` can't reassign it. Routing every module through
// `state.currentUser = ...` keeps the mutation legal and keeps a single source of truth.
export const state = {
  currentUser: null,
  unsubscribeTasks: null,
  unsubscribeLists: null,
  editingTaskId: null,
  tasksCache: [],
  myLists: [],              // shared lists the user belongs to (from 'lists' collection)
  currentListId: null,      // null/undefined => personal list (listId == currentUser.uid)
  currentSort: 'custom',
  filterStatusVal: 'all',
  filterPriorityVal: 'all',
  filterTagVal: 'all',
  searchQueryVal: '',
  draggedTaskId: null,
  expandedTasks: new Set(),
  pendingDeleteTimers: new Map(), // taskId -> setTimeout handle, for undo-delete
  toastSeq: 0,
  pageSize: 50,              // Firestore query limit — grows via "Load more"
  lastSnapCount: 0,          // docs returned by the most recent snapshot, to know if more may exist
  verifyBannerDismissed: false,
  selectedTaskIds: new Set(),
  kbFocusIndex: -1, // index into the currently visible/sorted task list, for keyboard navigation
  unsubscribePresence: null,
  presenceHeartbeatInterval: null,
  typingClearTimer: null,
  remindersInterval: null,
  notifiedToday: new Set(), // taskIds already notified this session/day, to avoid repeat spam
  addingTask: false
};

export const PRESENCE_STALE_MS = 30000;   // treat a presence doc older than this as "offline"
export const PRESENCE_HEARTBEAT_MS = 15000;
export const UNDO_DELETE_MS = 5000;
