(() => {
  const { findByProps, findByStoreName } = vendetta.metro;
  const { FluxDispatcher, React, ReactNative } = vendetta.metro.common;
  const { storage } = vendetta.plugin;
  const { useProxy } = vendetta.storage;
  const { Forms } = vendetta.ui.components;
  const { FormRow, FormSwitch, FormInput, FormSection } = Forms;

  const RestAPI = findByProps("getAPIBaseURL", "get");
  const UserStore = findByStoreName("UserStore");

  const pending = new Map(); // channelId -> expiry timestamp
  const timers = new Set();

  const defaults = {
    delay: "5",
    prefixes: "! / . - ? $",
    cleanBotReplies: true,
    realDeleteBotReplies: false,
    replyWindow: "10",
  };
  for (const k in defaults) storage[k] ??= defaults[k];

  const secs = (v, fallback) => {
    const n = parseFloat(v);
    return (isNaN(n) || n < 0 ? fallback : n) * 1000;
  };

  const isCommand = (content = "") =>
    String(storage.prefixes)
      .split(/\s+/)
      .filter(Boolean)
      .some((p) => content.startsWith(p));

  const hideLocal = (channelId, id) =>
    FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", channelId, id });

  async function remove(channelId, id, real) {
    try {
      if (real) await RestAPI.del({ url: `/channels/${channelId}/messages/${id}` });
      else hideLocal(channelId, id);
    } catch (e) {
      hideLocal(channelId, id); // fallback if delete failed (e.g. no permission)
    }
  }

  function schedule(channelId, id, real) {
    const t = setTimeout(() => {
      timers.delete(t);
      remove(channelId, id, real);
    }, secs(storage.delay, 5));
    timers.add(t);
  }

  function onMessage({ message, optimistic }) {
    if (!message || optimistic) return;
    const me = UserStore.getCurrentUser()?.id;
    if (!me) return;
    const ch = message.channel_id;

    // 1) your prefix command
    if (message.author?.id === me && isCommand(message.content)) {
      pending.set(ch, Date.now() + secs(storage.replyWindow, 10));
      schedule(ch, message.id, true);
      return;
    }

    if (!storage.cleanBotReplies) return;

    // 2) slash command response that you triggered
    const invoker =
      message.interaction_metadata?.user?.id ?? message.interaction?.user?.id;
    if (invoker === me) {
      schedule(ch, message.id, storage.realDeleteBotReplies);
      return;
    }

    // 3) bot reply shortly after your prefix command
    const until = pending.get(ch);
    if (message.author?.bot && until && Date.now() < until) {
      schedule(ch, message.id, storage.realDeleteBotReplies);
    }
  }

  function Settings() {
    useProxy(storage);
    return React.createElement(
      ReactNative.ScrollView,
      null,
      React.createElement(
        FormSection,
        { title: "Command Ghost" },
        React.createElement(FormInput, {
          title: "Delete delay (seconds)",
          value: String(storage.delay),
          keyboardType: "numeric",
          onChange: (v) => (storage.delay = v),
        }),
        React.createElement(FormInput, {
          title: "Command prefixes (space-separated)",
          value: storage.prefixes,
          onChange: (v) => (storage.prefixes = v),
        }),
        React.createElement(FormInput, {
          title: "Reply detection window (seconds)",
          value: String(storage.replyWindow),
          keyboardType: "numeric",
          onChange: (v) => (storage.replyWindow = v),
        }),
        React.createElement(FormRow, {
          label: "Also clean bot replies",
          trailing: React.createElement(FormSwitch, {
            value: storage.cleanBotReplies,
            onValueChange: (v) => (storage.cleanBotReplies = v),
          }),
        }),
        React.createElement(FormRow, {
          label: "Really delete bot replies",
          subLabel: "Needs Manage Messages. Off = only hidden for you.",
          trailing: React.createElement(FormSwitch, {
            value: storage.realDeleteBotReplies,
            onValueChange: (v) => (storage.realDeleteBotReplies = v),
          }),
        })
      )
    );
  }

  return {
    onLoad() {
      FluxDispatcher.subscribe("MESSAGE_CREATE", onMessage);
    },
    onUnload() {
      FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessage);
      timers.forEach(clearTimeout);
      timers.clear();
      pending.clear();
    },
    settings: Settings,
  };
})()
