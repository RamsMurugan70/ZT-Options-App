import React from 'react';
import OptionsTrackerPage from './components/OptionsTrackerPage';
import MainLayout from './components/Layout/MainLayout';
import Navbar from './components/Navbar';

function App() {
  return (
    <MainLayout>
      <Navbar />
      <main className="container mx-auto px-4 py-8 relative z-20">
        <OptionsTrackerPage />
      </main>
    </MainLayout>
  );
}

export default App;
