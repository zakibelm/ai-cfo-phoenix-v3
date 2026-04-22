import React from 'react';

interface BannerProps {
  message: string;
  type: 'warning' | 'error' | 'info';
}

const Banner: React.FC<BannerProps> = ({ message, type }) => {
  return (
    <div className={`banner banner--${type}`}>
      {message}
    </div>
  );
};

export default Banner;
