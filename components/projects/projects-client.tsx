"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { ProjectForm } from "@/components/projects/project-form"

export function ProjectsHeader() {
  const [showProjectForm, setShowProjectForm] = useState(false)

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Projects</h1>
          <p className="text-muted-foreground mt-1">Manage your projects and track progress</p>
        </div>
        <Button className="gap-2 bg-primary hover:bg-primary-600" onClick={() => setShowProjectForm(true)}>
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {showProjectForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-lg max-w-2xl w-full mx-4">
            <ProjectForm onClose={() => setShowProjectForm(false)} />
          </div>
        </div>
      )}
    </>
  )
}
