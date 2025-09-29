import Taxonium from "./Taxonium";
import "./App.css";

function App() {
  const sourceData = {
    status: "url_supplied",
    filename: "https://cov2tree.nyc3.cdn.digitaloceanspaces.com/tfci-taxonium.jsonl.gz",
    filetype: "jsonl",
  };

  return <Taxonium sourceData={sourceData} />;
}

export default App;
