# Tesseract OCR with Arabic + English models, for hosts where installing system packages is not possible.
FROM registry.fedoraproject.org/fedora-minimal:42
RUN microdnf install -y tesseract tesseract-langpack-ara tesseract-langpack-eng && microdnf clean all
ENTRYPOINT ["tesseract"]
