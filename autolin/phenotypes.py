import os 
import argparse
import subprocess
import gzip


def parse_args():
    parser = argparse.ArgumentParser(description="Process phenotype data.")
    parser.add_argument(
        "--metadata_file",
        '-m',
        type=str,
        required=True,
        help="Path to the input metadata file.",
    )
    parser.add_argument(
        "--mat",
        "-t",
        type=str,
        required=True,
        help="Path to the input mutation annotated tree",
    )
    parser.add_argument(
        "--column-name",
        "-c",
        type=str,
        required=True,
        help="Name of the column to extract from the metadata file",
    )
    parser.add_argument(
        "--output_file", 
        '-o',
        type=str,
        required=True,
        help="Path to the output file.",
    )
    return parser.parse_args()

def get_samples(tree):
    cmd = f"matUtils summary -i {tree} -s samples.subprocess"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed with error: {result.stderr}")
    with open("samples.subprocess", 'r') as f:
        samples = [line.strip().split()[0] for line in f if line.strip()]
    os.remove("samples.subprocess")
    return samples

def read_meta(file, samples):
    print(samples)
    metadata = {}
    headers = file.readline().strip().split('\t')
    for line in file:
        parts = line.strip().split()
        sample_id = parts[0]
        #print(sample_id)
        if sample_id in samples:
            metadata[sample_id] = {headers[i]: parts[i] for i in range(1, len(parts))}
    print(metadata)
    return metadata

def get_metadata(samples, metadata_file):
    if metadata_file.endswith(".gz"):
        with gzip.open(metadata_file, "rt") as gz:
            metadata = read_meta(gz, samples)
            '''
            for line in gz:
                parts = line.strip().split(',')
                sample_id = parts[0]
                if sample_id in samples:
                    metadata[sample_id] = {headers[i]: parts[i] for i in range(1, len(parts))}
            '''
    else:
        with open(metadata_file, 'r') as f:
            metadata = read_meta(f, samples)
            '''
            for line in f:
                parts = line.strip().split(',')
                sample_id = parts[0]
                if sample_id in samples:
                    metadata[sample_id] = {headers[i]: parts[i] for i in range(1, len(parts))}
            '''
    return metadata
    ''' 
    with gzip.open(metadata_file, 'r') as f:
        headers = f.readline().strip().split(',')
        for line in f:
            parts = line.strip().split(',')
            sample_id = parts[0]
            if sample_id in samples:
                metadata[sample_id] = {headers[i]: parts[i] for i in range(1, len(parts))}
    return metadata

'''

'''
def get_metadata(metadata_file):
    # Sort samples and metadata
    subprocess.run("sort samples.subprocess > samples.sorted", shell=True, check=True)
    subprocess.run(f"sort -t, -k1,1 {metadata_file} > metadata.sorted", shell=True, check=True)
    # Join sorted files
    subprocess.run("join -t, samples.sorted metadata.sorted > matched_metadata.csv", shell=True, check=True)
    
    # Read matched metadata
    metadata = {}
    with open("matched_metadata.csv", "r") as f:
        for line in f:
            parts = line.strip().split(",")
            sample_id = parts[0]
            metadata[sample_id] = parts[1:]
    # Optionally, clean up temp files
    # os.remove("samples.subprocess")
    # os.remove("samples.sorted")
    # os.remove("metadata.sorted")
    # os.remove("matched_metadata.csv")
    
    #return metadata
'''


def main():
    args = parse_args()
    tree = args.mat
    samples = get_samples(tree)
    print(f"Extracted {len(samples)} samples from the tree.")
    meta = get_metadata(samples, args.metadata_file)
    print(len(meta))
    '''
    # Read metadata file
    with open(args.metadata_file, 'r') as f:
        metadata_lines = f.readlines()
    
    # Read mutation annotated tree file
    with open(args.mat, 'r') as f:
        mat_lines = f.readlines()
    
    # Process data (this is a placeholder for actual processing logic)
    processed_data = []
    for line in metadata_lines:
        if line.strip():  # Skip empty lines
            processed_data.append(line.strip())
    
    for line in mat_lines:
        if line.strip():  # Skip empty lines
            processed_data.append(line.strip())
    
    # Write to output file
    with open(args.output_file, 'w') as f:
        for item in processed_data:
            f.write(f"{item}\n")
    
    print(f"Processed data written to {args.output_file}")
    '''

if __name__ == "__main__":
    main()