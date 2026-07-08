import React from 'react';
import ReactDOM from 'react-dom';
import Taxonium from './Taxonium';
import './App.css';

// Render Taxonium with the backend URL
ReactDOM.render(
  <React.StrictMode>
    <div style={{ width: '100%', height: '100vh' }}>
      <Taxonium backendUrl="https://api.cov2tree.org" />
    </div>
  </React.StrictMode>,
  document.getElementById('root')
); 