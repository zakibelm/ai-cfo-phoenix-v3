import React from 'react';

export const PlaygroundIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg
        {...props}
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="m18 10-2.5 2.5a3.5 3.5 0 0 1-5 0L8 10" />
        <path d="M12 22V12" />
        <path d="M12 2h.01" />
        <path d="M7 3.34V5l-1.7 1.7a2.8 2.8 0 1 0 4.05 4.05L12 8l2.65-2.65a2.8 2.8 0 1 0-4.05-4.05L7 5v-1.66" />
        <path d="M17 3.34V5l1.7 1.7a2.8 2.8 0 1 1-4.05 4.05L12 8l-2.65-2.65a2.8 2.8 0 1 1 4.05-4.05L17 5v-1.66" />
    </svg>
);
