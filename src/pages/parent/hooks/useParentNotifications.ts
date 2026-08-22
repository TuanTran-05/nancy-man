import { useState } from 'react';
import { apiRequest } from '../../../lib/api/apiClient';
import { Notification as AppNotification } from '../../../types';

export function useParentNotifications(notifications: AppNotification[]) {
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<AppNotification | null>(null);
  const [isMarkingNotifications, setIsMarkingNotifications] = useState(false);

  const unreadNotifications = notifications.filter((notification) => !notification.isRead);

  const markNotificationAsRead = async (notificationId: string) => {
    try {
      await apiRequest('/api/v1/messages/mark-notification-read', {
        method: 'POST',
        body: { notificationId },
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllNotificationsAsRead = async () => {
    if (!unreadNotifications.length || isMarkingNotifications) return;

    setIsMarkingNotifications(true);
    try {
      await apiRequest('/api/v1/messages/mark-all-notifications-read', {
        method: 'POST',
        body: { notificationIds: unreadNotifications.map((n) => n.id) },
      });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    } finally {
      setIsMarkingNotifications(false);
    }
  };

  return {
    isNotificationOpen,
    setIsNotificationOpen,
    selectedNotification,
    setSelectedNotification,
    isMarkingNotifications,
    unreadNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
  };
}
