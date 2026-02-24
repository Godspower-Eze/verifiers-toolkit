import React, { useEffect, useRef } from 'react';
import styles from './DeploymentLogs.module.css';

export type LogType = 'info' | 'success' | 'error' | 'warning';

export interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: LogType;
}

interface DeploymentLogsProps {
  logs: LogEntry[];
}

export default function DeploymentLogs({ logs }: DeploymentLogsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div className={styles.emptyContainer}>
        <span className={styles.emptyText}>Deployment logs will appear here...</span>
      </div>
    );
  }

  return (
    <div className={styles.container} ref={containerRef}>
      {logs.map((log) => {
        const time = log.timestamp.toLocaleTimeString(undefined, {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        return (
          <div key={log.id} className={`${styles.logRow} ${styles[log.type]}`}>
            <span className={styles.timestamp}>[{time}]</span>
            <span className={styles.message}>{log.message}</span>
          </div>
        );
      })}
    </div>
  );
}
