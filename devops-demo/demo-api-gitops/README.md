# kubeorbit-demo-api-gitops

Desired state for `kubeorbit-demo-api`. **ArgoCD watches this repo; humans rarely edit it.**
CI in the app repo commits here every time a new image is built.

```
k8s/base/            Deployment, Service, ConfigMap: shared by every environment
k8s/overlays/dev/    namespace kubeorbit-demo-dev, 1 replica, image tag set by CI (auto-sync)
k8s/overlays/prod/   namespace kubeorbit-demo-prod, 2 replicas + PDB (manual sync)
k8s/overlays/local/  image built into Minikube, for learning without a registry
argocd/              the ArgoCD Applications that point at the overlays
```

Preview exactly what ArgoCD will apply:

```bash
kubectl kustomize k8s/overlays/dev
```

## Roll back

Every deploy is a commit here (`deploy(dev): demo-api <tag>`). To roll back, revert that commit:
ArgoCD syncs the previous image. No kubectl needed.
