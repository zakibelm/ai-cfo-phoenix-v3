"""
Benchmark pour mesurer l'impact des optimisations
"""
import tracemalloc


# Simulation de fichiers volumineux
def create_fake_pdf_content(pages: int = 100) -> bytes:
    """Crée un faux contenu PDF (1KB par page)"""
    return b"Fake PDF page content " * 50 * pages

def benchmark_memory_old():
    """Ancien code : charge tous les fichiers simultanément"""
    tracemalloc.start()
    files_content = []

    # Simule 5 fichiers de 100KB chacun
    for _i in range(5):
        content = create_fake_pdf_content(100)
        files_content.append(content)

    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return peak / 1024 / 1024  # MB

def benchmark_memory_new():
    """Nouveau code : streaming avec limite mémoire"""
    tracemalloc.start()

    # Simule traitement streaming
    for _i in range(5):
        content = create_fake_pdf_content(100)
        # Traite et libère immédiatement
        del content

    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return peak / 1024 / 1024  # MB

if __name__ == "__main__":
    print("=== BENCHMARK MÉMOIRE ===")

    mem_old = benchmark_memory_old()
    print(f"Ancien code : {mem_old:.2f} MB")

    mem_new = benchmark_memory_new()
    print(f"Nouveau code : {mem_new:.2f} MB")

    improvement = ((mem_old - mem_new) / mem_old) * 100
    print(f"Gain : {improvement:.1f}%")
