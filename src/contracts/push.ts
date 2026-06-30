export interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushSubscribeRequest {
  subscription: PushSubscriptionPayload;
}

export interface PushUnsubscribeRequest {
  endpoint: string;
}

export interface PushSubscribeResponse {
  subscribed: boolean;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  vibrate?: number[];
  requireInteraction?: boolean;
  actions?: Array<{ action: string; title: string }>;
  badge?: string;
  icon?: string;
}
