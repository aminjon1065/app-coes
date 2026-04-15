"use client";

import { create } from "zustand";
import type { ChatChannel, ChatMessage, ChatReaction } from "@/lib/api/chat-workspace";

type TypingUser = {
  userId: string;
  channelId: string;
  startedAt: number;
};

type ChatStore = {
  channels: ChatChannel[];
  messages: Record<string, ChatMessage[]>;
  unreadCounts: Record<string, number>;
  typingUsers: Record<string, TypingUser[]>;
  activeChannelId: string | null;
  highlightedMessageIds: string[];
  setInitialState: (input: {
    channels: ChatChannel[];
    activeChannelId: string | null;
    messages: ChatMessage[];
  }) => void;
  setActiveChannel: (channelId: string | null) => void;
  appendMessage: (message: ChatMessage, highlight?: boolean) => void;
  replaceMessage: (message: ChatMessage) => void;
  setMessageReactions: (channelId: string, messageId: string, reactions: ChatReaction[]) => void;
  setTyping: (channelId: string, userId: string, isTyping: boolean) => void;
  clearHighlight: (messageId: string) => void;
  markRead: (channelId: string) => void;
};

function sortMessages(messages: ChatMessage[]) {
  return messages
    .slice()
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );
}

export const useChatStore = create<ChatStore>((set) => ({
  channels: [],
  messages: {},
  unreadCounts: {},
  typingUsers: {},
  activeChannelId: null,
  highlightedMessageIds: [],
  setInitialState: ({ channels, activeChannelId, messages }) =>
    set({
      channels,
      activeChannelId,
      messages: activeChannelId ? { [activeChannelId]: sortMessages(messages) } : {},
      unreadCounts: Object.fromEntries(
        channels.map((channel) => [channel.id, channel.unreadCount ?? 0]),
      ),
      typingUsers: {},
      highlightedMessageIds: [],
    }),
  setActiveChannel: (channelId) =>
    set((state) => ({
      activeChannelId: channelId,
      unreadCounts: channelId
        ? { ...state.unreadCounts, [channelId]: 0 }
        : state.unreadCounts,
    })),
  appendMessage: (message, highlight = false) =>
    set((state) => {
      const channelMessages = state.messages[message.channelId] ?? [];
      const exists = channelMessages.some((item) => item.id === message.id);
      const messages = exists
        ? channelMessages.map((item) => (item.id === message.id ? message : item))
        : [...channelMessages, message];
      const isActive = state.activeChannelId === message.channelId;

      return {
        messages: {
          ...state.messages,
          [message.channelId]: sortMessages(messages),
        },
        unreadCounts: isActive
          ? { ...state.unreadCounts, [message.channelId]: 0 }
          : {
              ...state.unreadCounts,
              [message.channelId]: (state.unreadCounts[message.channelId] ?? 0) + 1,
            },
        highlightedMessageIds:
          highlight && !state.highlightedMessageIds.includes(message.id)
            ? [message.id, ...state.highlightedMessageIds].slice(0, 20)
            : state.highlightedMessageIds,
      };
    }),
  replaceMessage: (message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [message.channelId]: sortMessages(
          (state.messages[message.channelId] ?? []).map((item) =>
            item.id === message.id ? message : item,
          ),
        ),
      },
    })),
  setMessageReactions: (channelId, messageId, reactions) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] ?? []).map((message) =>
          message.id === messageId ? { ...message, reactions } : message,
        ),
      },
    })),
  setTyping: (channelId, userId, isTyping) =>
    set((state) => {
      const current = state.typingUsers[channelId] ?? [];
      const next = isTyping
        ? [
            ...current.filter((item) => item.userId !== userId),
            { channelId, userId, startedAt: Date.now() },
          ]
        : current.filter((item) => item.userId !== userId);

      return {
        typingUsers: {
          ...state.typingUsers,
          [channelId]: next,
        },
      };
    }),
  clearHighlight: (messageId) =>
    set((state) => ({
      highlightedMessageIds: state.highlightedMessageIds.filter((id) => id !== messageId),
    })),
  markRead: (channelId) =>
    set((state) => ({
      unreadCounts: { ...state.unreadCounts, [channelId]: 0 },
    })),
}));
