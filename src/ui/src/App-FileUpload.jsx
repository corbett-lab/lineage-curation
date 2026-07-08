import React, { useState } from 'react'
import Taxonium from './Taxonium'
import './taxonium.css'

function App() {
  const [sourceData, setSourceData] = useState(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleFileUpload = (event) => {
    const file = event.target.files[0]
    if (file && file.name.endsWith('.jsonl')) {
      setIsLoading(true)
      const reader = new FileReader()
      
      reader.onload = (e) => {
        const fileContent = e.target.result
        setSourceData({
          status: "loaded",
          filename: file.name,
          filetype: "jsonl",
          data: fileContent
        })
        setIsLoading(false)
      }
      
      reader.onerror = (e) => {
        console.error('Error reading file:', e)
        setIsLoading(false)
      }
      
      reader.readAsText(file)
    } else {
      alert('Please select a .jsonl file')
    }
  }

  // If no file is loaded, show file picker
  if (!sourceData) {
    return (
      <div className="App" style={{ padding: '20px', textAlign: 'center' }}>
        <h2>Load Local JSONL File</h2>
        <input 
          type="file" 
          accept=".jsonl"
          onChange={handleFileUpload}
          style={{ margin: '20px' }}
        />
        {isLoading && <div>Loading file...</div>}
      </div>
    )
  }

  return (
    <div className="App">
      <Taxonium sourceData={sourceData} />
    </div>
  )
}

export default App
