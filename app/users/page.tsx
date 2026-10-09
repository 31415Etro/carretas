"use client"

import { useState, useEffect } from "react"
import { PageLayout } from "@/components/page-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserForm } from "@/components/users/user-form"
import { UsersTable } from "@/components/users/users-table"
import { SalesTargetsDialog } from "@/components/users/sales-targets-dialog"
import { ManagerRepresentativesDialog } from "@/components/users/manager-representatives-dialog"
import type { User } from "@/lib/types"
import { UserPlus, Search, Shield, Loader2, Target } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function UsersPage() {
  const { toast } = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [showTargetsDialog, setShowTargetsDialog] = useState(false)
  const [targetUser, setTargetUser] = useState<User | null>(null)
  const [showRepresentativesDialog, setShowRepresentativesDialog] = useState(false)
  const [managerUser, setManagerUser] = useState<User | null>(null)

  const fetchUsers = async () => {
    try {
      setLoading(true)
      console.log("[v0] Fetching users from API")

      const response = await fetch("/api/users")
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch users")
      }

      console.log("[v0] Users fetched:", data.users?.length)
      setUsers(data.users || [])
    } catch (error) {
      console.error("[v0] Error fetching users:", error)
      toast({
        title: "Error",
        description: "Failed to load users",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const filteredUsers = users.filter(
    (user) =>
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.role.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const handleEdit = (user: User) => {
    setEditingUser(user)
    setShowForm(true)
  }

  const handleDelete = (userId: string) => {
    setUsers(users.filter((u) => u.id !== userId))
  }

  const handleFormSuccess = () => {
    fetchUsers()
    setEditingUser(null)
  }

  const handleManageTargets = (user: User) => {
    setTargetUser(user)
    setShowTargetsDialog(true)
  }

  const handleManageRepresentatives = (user: User) => {
    setManagerUser(user)
    setShowRepresentativesDialog(true)
  }

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-balance">User Management</h1>
            <p className="text-muted-foreground mt-1">Manage users, roles, and page permissions</p>
          </div>
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Add User
          </Button>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Admin Access Required</CardTitle>
            </div>
            <CardDescription>
              Only administrators can create and manage users. You can assign roles (SDR, Closer, Admin) and configure
              page-level permissions for each user.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-orange-500" />
              <CardTitle className="text-lg">Metas Anuais</CardTitle>
            </div>
            <CardDescription>
              Configure metas anuais de receita, leads e negócios fechados para cada vendedor. Use o botão "Gerenciar
              Metas" na tabela de usuários.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>All Users</CardTitle>
                <CardDescription>
                  {loading
                    ? "Loading..."
                    : `${filteredUsers.length} user${filteredUsers.length !== 1 ? "s" : ""} found`}
                </CardDescription>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  disabled={loading}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-sm text-muted-foreground">Loading users...</p>
              </div>
            ) : filteredUsers.length > 0 ? (
              <UsersTable
                users={filteredUsers}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onManageTargets={handleManageTargets}
                onManageRepresentatives={handleManageRepresentatives}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Shield className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-semibold mb-2">No users found</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {searchQuery ? "Try adjusting your search" : "Get started by creating your first user"}
                </p>
                {!searchQuery && (
                  <Button onClick={() => setShowForm(true)} variant="outline" className="gap-2">
                    <UserPlus className="h-4 w-4" />
                    Add User
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {showForm && (
          <UserForm
            user={editingUser}
            onClose={() => {
              setShowForm(false)
              setEditingUser(null)
            }}
            onSuccess={handleFormSuccess}
          />
        )}

        {showTargetsDialog && targetUser && (
          <SalesTargetsDialog
            user={targetUser}
            onClose={() => {
              setShowTargetsDialog(false)
              setTargetUser(null)
            }}
            onSuccess={() => {
              toast({
                title: "Sucesso",
                description: "Meta atualizada com sucesso",
              })
            }}
          />
        )}

        {showRepresentativesDialog && managerUser && (
          <ManagerRepresentativesDialog
            manager={managerUser}
            onClose={() => {
              setShowRepresentativesDialog(false)
              setManagerUser(null)
            }}
            onSuccess={() => {
              fetchUsers()
              toast({
                title: "Sucesso",
                description: "Representantes atualizados com sucesso",
              })
            }}
          />
        )}
      </div>
    </PageLayout>
  )
}
