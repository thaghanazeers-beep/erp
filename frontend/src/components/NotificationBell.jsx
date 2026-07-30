import { useState, useEffect, useRef } from 'react';
import { getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead } from '../api';
import { useAuth } from '../context/AuthContext';
import './NotificationBell.css';

const NOTIF_ICONS = {
  task_created: '📋',
  task_assigned: '👤',
  status_changed: '🔄',
  task_completed: '✅',
  task_rejected: '❌',
  review_requested: '📝',
};

export default function NotificationBell({ onToast }) {
  const { user } = useAuth();
  const userName = user?.name || '';
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevCountRef = useRef(0);
  const dropdownRef = useRef(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // poll every 5s
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchData = async () => {
    if (!userName) return;
    try {
      const [nRes, cRes] = await Promise.all([getNotifications(userName), getUnreadCount(userName)]);
      setNotifications(nRes.data);
      const newCount = cRes.data.count;
      // Toast for new notifications
      if (newCount > prevCountRef.current && prevCountRef.current > 0) {
        const latest = nRes.data[0];
        if (latest && onToast) {
          onToast({
            type: latest.type,
            title: latest.title,
            message: latest.message,
          });
        }
      }
      prevCountRef.current = newCount;
      setUnreadCount(newCount);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRead = async (id) => {
    try {
      await markNotificationRead(id);
      setNotifications(prev => prev.map(n => n._id === id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) { console.error(err); }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead(userName);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) { console.error(err); }
  };

  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="notif-wrapper" ref={dropdownRef}>
      <button className="notif-bell" onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown animate-in">
          <div className="notif-dropdown-header">
            <h3>Notifications</h3>
            {unreadCount > 0 && (
              <button className="notif-mark-all" onClick={handleMarkAllRead}>Mark all read</button>
            )}
          </div>
          <div className="notif-list">
            {notifications.length === 0 ? (
              <div className="notif-empty">
                <span>🔔</span>
                <p>No notifications yet</p>
              </div>
            ) : notifications.map(n => (
              <div
                className={`notif-item ${!n.read ? 'notif-unread' : ''}`}
                key={n._id}
                onClick={() => {
                  if (!n.read) handleRead(n._id);
                  if (n.taskId) {
                    window.pendingOpenTaskId = n.taskId;
                    window.dispatchEvent(new CustomEvent('NAVIGATE_TO_TASK'));
                    setOpen(false);
                  }
                }}
              >
                <div className="notif-item-icon">
                  {NOTIF_ICONS[n.type] || '📢'}
                </div>
                <div className="notif-item-content">
                  <div className="notif-item-title">{n.title}</div>
                  <div className="notif-item-message">{n.message}</div>
                  <div className="notif-item-time">{timeAgo(n.createdAt)}</div>
                </div>
                {!n.read && <div className="notif-dot" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
