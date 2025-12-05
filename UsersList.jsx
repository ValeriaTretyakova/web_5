import React from 'react';
import { FiUser } from 'react-icons/fi';

const UsersList = ({ users }) => {
  return (
    <ul className="users-list">
      {users.map((user) => (
        <li key={user.id} className="user-item">
          <div 
            className="user-color" 
            style={{ backgroundColor: user.color }}
            title={`Цвет пользователя ${user.username}`}
          />
          <span className="user-name">
            <FiUser style={{ marginRight: '8px' }} />
            {user.username}
            {user.id && (
              <span style={{
                fontSize: '0.8rem',
                color: '#666',
                marginLeft: '8px'
              }}>
                (ID: {user.id.substring(0, 8)}...)
              </span>
            )}
          </span>
          <div className="status-indicator">
            онлайн
          </div>
        </li>
      ))}
      
      {users.length === 0 && (
        <li className="user-item" style={{ textAlign: 'center', color: '#666' }}>
          Нет подключенных пользователей
        </li>
      )}
    </ul>
  );
};

export default UsersList;