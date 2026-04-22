import React from 'react';
import { CheckIcon } from './icons/CheckIcon';

interface ToastProps {
  message: string;
  isVisible: boolean;
}

const Toast: React.FC<ToastProps> = ({ message, isVisible }) => {
  if (!isVisible) return null;

  return (
    <div className="fixed bottom-8 right-8 bg-secondary border border-border text-foreground text-sm font-semibold px-5 py-3 rounded-lg shadow-2xl flex items-center gap-3 animate-slide-up-fade">
      <CheckIcon className="w-5 h-5 text-green-400" />
      <span>{message}</span>
    </div>
  );
};

export default Toast;
