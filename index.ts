const PREFIXES = ["?", "!", ".", "-", "$", "%"];
const DELETE_AFTER_MS = 5000;
const REPLY_WINDOW_MS = 10000;

// ⚠️ Adapt these lookups to however the Revenge JS API exposes Discord modules
declare const findByProps: (...props: string[]) => any;
const FluxDispatcher = findByProps("dispatch", "subscribe");
const MessageActions = findByProps("deleteMessage", "sendMessage");
const UserStore = findByProps("getCurrentUser");

const timers = new Set<ReturnType<typeof setTimeout>>();
const myCommands = new Set<string>();
const lastCommandAt = new Map<string, number>(); // channelId -> timestamp

function scheduleDelete(channelId: string, messageId: string) {
  const t = setTimeout(() => {
    timers.delete(t);
    try {
      MessageActions.deleteMessage(channelId, messageId);
    } catch {}
  }, DELETE_AFTER_MS);
  timers.add(t);
}

function onMessage({ message, optimistic }: any) {
  if (!message || optimistic) return;
  const me = UserStore.getCurrentUser()?.id;

  // 1. My own prefix command
  if (message.author?.id === me) {
    const content: string = message.content ?? "";
    if (PREFIXES.some((p) => content.startsWith(p))) {
      myCommands.add(message.id);
      lastCommandAt.set(message.channel_id, Date.now());
      scheduleDelete(message.channel_id, message.id);
    }
    return;
  }

  if (!message.author?.bot) return;

  // 2. Bot reply: direct reply, slash command, or any bot message
  //    shortly after my command in the same channel
  const repliedTo = message.message_reference?.message_id;
  const isDirectReply = repliedTo && myCommands.has(repliedTo);
  const isSlashReply = message.interaction?.user?.id === me;
  const last = lastCommandAt.get(message.channel_id) ?? 0;
  const isRecent = Date.now() - last < REPLY_WINDOW_MS;

  if (isDirectReply || isSlashReply || isRecent) {
    scheduleDelete(message.channel_id, message.id);
  }
}

export default {
  start() {
    FluxDispatcher.subscribe("MESSAGE_CREATE", onMessage);
  },
  stop() {
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessage);
    timers.forEach(clearTimeout);
    timers.clear();
    myCommands.clear();
    lastCommandAt.clear();
  },
};
