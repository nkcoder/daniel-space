import React from 'react';

interface CalloutProps {
  children: React.ReactNode;
  type?: 'info' | 'warning' | 'error';
  emoji?: string;
}

export function Callout({ children, type = 'info', emoji }: CalloutProps) {
  const styles = {
    info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100',
    warning:
      'border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-100',
    error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100'
  };

  return (
    <div className={`callout ${styles[type]} my-6 flex gap-3 rounded-lg border px-4 py-3`}>
      {emoji && <span className="select-none text-lg">{emoji}</span>}
      <div className="w-full min-w-0 [&>p]:mb-0">{children}</div>
    </div>
  );
}
