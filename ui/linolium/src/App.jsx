import React, { useState, useEffect, Suspense, lazy } from 'react';

const Taxonium = lazy(() => import('taxonium-component'));

function App() {
  const [backendReady, setBackendReady] = useState(false)
  const [backendError, setBackendError] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  
  useEffect(() => {
    // Check if backend server is ready
    const checkBackend = async () => {
      try {
        console.log('Checking backend server...')
        const response = await fetch('http://localhost:8001/config')
        if (response.ok) {
          console.log('Backend server is ready')
          setBackendReady(true)
          setIsLoading(false)
        } else {
          throw new Error(`Backend server returned status: ${response.status}`)
        }
      } catch (error) {
        console.error('Backend server not ready:', error.message)
        setBackendError(error.message)
        // Retry after a short delay
        setTimeout(checkBackend, 2000)
      }
    }
    
    // Start checking backend
    checkBackend()
  }, [])
  
  // Show loading state
  if (isLoading) {
    return (
      <div className="loading-container">
        <h2>Starting Taxonium backend server...</h2>
        <p>Loading MTB phylogenetic tree data...</p>
        {backendError && (
          <div style={{ marginTop: '20px', color: '#e74c3c' }}>
            <p>Waiting for backend: {backendError}</p>
            <p>Retrying...</p>
          </div>
        )}
      </div>
    )
  }
  
  // Show error if backend failed
  if (backendError && !backendReady) {
    return (
      <div className="error-container">
        <h2>Backend Server Error</h2>
        <p>{backendError}</p>
        <p>Make sure the backend server is running on port 8001</p>
      </div>
    )
  }

  // Backend is ready, connect Taxonium to it
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <div className="h-full">
        <Suspense fallback={<div>Loading Taxonium...</div>}>
          <Taxonium
            backendUrl="http://localhost:8001"
            sidePanelHiddenByDefault={false}
          />
        </Suspense>
      </div>
    </div>
  )
}

export default App